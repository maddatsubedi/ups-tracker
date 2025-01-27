import time
import csv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

input_csv_file = "./python/shipment export with additional columns.csv"
output_csv_file = "./python/output.csv"

service_levels = {
    'Next Day Air Early AM': {'earliest': '8:00 A.M.', 'latest': '9:30 A.M.', 'daysLimit': 1},
    'Next Day Air': {'earliest': '10:30 A.M.', 'latest': '12:00 P.M.', 'daysLimit': 1},
    'Next Day Air Saver': {'earliest': '3:00 P.M.', 'latest': '11:59 P.M.', 'daysLimit': 1},
    '2nd Day Air AM': {'earliest': '10:30 A.M.', 'latest': '12:00 P.M.', 'daysLimit': 2},
    '2nd Day Air': {'earliest': '1:00 P.M.', 'latest': '11:59 P.M.', 'daysLimit': 2}
}

def read_csv(file_path):
    rows = []
    try:
        with open(file_path, mode='r', newline='', encoding='utf-8') as file:
            reader = csv.DictReader(file)
            for row in reader:
                rows.append(row)
    except FileNotFoundError:
        print(f"File not found: {file_path}")
    return rows

def write_csv(file_path, data):
    fieldnames = data[0].keys()
    with open(file_path, mode='a', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writerows(data)

def safe_eval_with_timeout(driver, selector, eval_callback, timeout=10):
    try:
        element = driver.find_element(By.CSS_SELECTOR, selector)
        return eval_callback(element)
    except:
        return None

def calculate_on_time(service_level, ship_date_str, ship_time_str, delivery_date_str, delivery_time_str):
    def parse_date_time(date_str, time_str):
        from datetime import datetime

        time_str = time_str.replace('.', '')

        return datetime.strptime(f"{date_str} {time_str}", '%m/%d/%Y %I:%M %p')

    service_details = service_levels[service_level]
    earliest = service_details['earliest']
    latest = service_details['latest']
    days_limit = service_details['daysLimit']

    ship_date = parse_date_time(ship_date_str, ship_time_str)
    delivery_date = parse_date_time(delivery_date_str, delivery_time_str)

    earliest_time = parse_date_time(delivery_date_str, earliest)
    latest_time = parse_date_time(delivery_date_str, latest)

    ship_day = ship_date.weekday()
    adjusted_days_limit = days_limit

    if ship_day == 4:
        adjusted_days_limit += 2
    elif ship_day == 5:
        adjusted_days_limit += 1

    delivery_ship_date_diff = (delivery_date - ship_date).days

    if delivery_ship_date_diff > adjusted_days_limit:
        return "No"
    elif delivery_date < earliest_time:
        return "Yes"
    elif earliest_time <= delivery_date <= latest_time:
        return "Research"
    else:
        return "No"

def is_row_processed(tracking_number):
    existing_data = read_csv(output_csv_file)
    return any(row["Ship Date"] and row["Airbill Number/BOL Number"] == tracking_number for row in existing_data)

def process_data():
    data = read_csv(input_csv_file)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))

    driver.get("https://www.ups.com/track")
    time.sleep(5)

    try:
        privacy_close_button = driver.find_element(By.CSS_SELECTOR, ".implicit_privacy_prompt .close_btn_thick")
        privacy_close_button.click()
    except:
        pass

    error_found = False
    messaging_box_closed = False
    started = False

    for i, row in enumerate(data):
        tracking_number = row["Airbill Number/BOL Number"]

        if not tracking_number or is_row_processed(tracking_number):
            continue

        try:
            if not error_found:
                if started:
                    track_again_input = driver.find_element(By.CSS_SELECTOR, "#stApp_trackAgain_trackingNumEntry")
                    track_again_input.send_keys(tracking_number)
                    track_again_button = driver.find_element(By.CSS_SELECTOR, "#stApp_trackAgain_getTrack")
                    track_again_button.click()
                else:
                    tracking_input = driver.find_element(By.CSS_SELECTOR, "#stApp_trackingNumber")
                    tracking_input.send_keys(tracking_number)
                    track_button = driver.find_element(By.CSS_SELECTOR, "#stApp_btnTrack")
                    track_button.click()
                    started = True
            else:
                tracking_input = driver.find_element(By.CSS_SELECTOR, "#stApp_trackingNumber")
                tracking_input.clear()
                tracking_input.send_keys(tracking_number)
                track_button = driver.find_element(By.CSS_SELECTOR, "#stApp_btnTrack")
                track_button.click()
                error_found = False

            error = safe_eval_with_timeout(
                driver, "#stApp_error_alert_list0", lambda el: el.text.strip(), timeout=5)

            if error:
                print(f"Error for tracking number {tracking_number}: {error}")
                row["Ship Date"] = "SCRIPT_ERROR"
                row["Delivery Date"] = "SCRIPT_ERROR"
                row["Delivery Time"] = "SCRIPT_ERROR"
                row["On Time?"] = "SCRIPT_ERROR"
                row["Weather?"] = "SCRIPT_ERROR"
                write_csv(output_csv_file, [row])
                error_found = True
                continue

            time.sleep(5)

            ship_date_and_time = safe_eval_with_timeout(
                driver, "#stApp_milestoneDateTime1", lambda el: el.text.strip(), timeout=5)
            if ship_date_and_time:
                ship_date, ship_time = ship_date_and_time.split(",")
                ship_date = ship_date.strip()
                ship_time = ship_time.strip()

            delivery_date_and_time = safe_eval_with_timeout(
                driver, "#stApp_milestoneDateTime4", lambda el: el.text.strip(), timeout=5)
            if delivery_date_and_time:
                splitted_delivery = delivery_date_and_time.split(",")
                delivery_date = splitted_delivery[0].strip()
                delivery_time = splitted_delivery[1].strip()

            if not messaging_box_closed:
                driver.implicitly_wait(10)
                try:
                    chatbox_frame = driver.find_element(By.CSS_SELECTOR, '#nuanMessagingFrame > iframe[src*="nuance-chat.html"]')
                    if chatbox_frame:
                        driver.switch_to.frame(chatbox_frame)
                        driver.find_element(By.CSS_SELECTOR, ".top-bar-item.icon").click()
                        driver.switch_to.default_content()
                    messaging_box_closed = True
                except Exception:
                    pass

            view_details_button = driver.find_element(By.CSS_SELECTOR, "#st_App_View_Details")
            view_details_button.click()

            weather_details = safe_eval_with_timeout(
                driver, ".ups-tab-content.top-tab", lambda el: "Yes" if "weather" in el.text.lower() else "No", timeout=5)

            service_level = row["Service Level"]
            on_time = calculate_on_time(service_level, ship_date, ship_time, delivery_date, delivery_time)

            print(ship_date, ship_time, delivery_date, delivery_time, weather_details, service_level, on_time)

            row["Ship Date"] = ship_date or "SCRIPT_ERROR"
            row["Delivery Date"] = delivery_date or "SCRIPT_ERROR"
            row["Delivery Time"] = delivery_time or "SCRIPT_ERROR"
            row["On Time?"] = on_time or "SCRIPT_ERROR"
            row["Weather?"] = weather_details or "SCRIPT_ERROR"

            write_csv(output_csv_file, [row])

            close_button = driver.find_element(By.CSS_SELECTOR, ".modal-content .modal-header .close")
            close_button.click()

            time.sleep(2)

        except Exception as error:
            print(f"Error processing tracking number {tracking_number}: {error}")
            row["Ship Date"] = "SCRIPT_ERROR"
            row["Delivery Date"] = "SCRIPT_ERROR"
            row["Delivery Time"] = "SCRIPT_ERROR"
            row["On Time?"] = "SCRIPT_ERROR"
            row["Weather?"] = "SCRIPT_ERROR"
            write_csv(output_csv_file, [row])

    driver.quit()

process_data()
print("CSV updated successfully!")

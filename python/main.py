import time
import csv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from datetime import datetime

input_csv_file = "./python/shipment export with additional columns.csv"
output_csv_file = "./python/output.csv"

service_levels = {
    'Next Day Air Early AM': {'earliest': '8:00 A.M.', 'latest': '9:30 A.M.', 'daysLimit': 1},
    'Next Day Air': {'earliest': '10:30 A.M.', 'latest': '12:00 P.M.', 'daysLimit': 1},
    'Next Day Air Saver': {'earliest': '3:00 P.M.', 'latest': '11:59 P.M.', 'daysLimit': 1},
    '2nd Day Air AM': {'earliest': '10:30 A.M.', 'latest': '12:00 P.M.', 'daysLimit': 2},
    '2nd Day Air': {'earliest': '1:00 P.M.', 'latest': '11:59 P.M.', 'daysLimit': 2}
}


def parse_date_time(date_str, time_str):
    date_parts = list(map(int, date_str.split('/')))
    time_parts = time_str.split(' ')
    month, day, year = date_parts
    hours, minutes = map(int, time_parts[0].split(':'))
    period = time_parts[1].upper()

    if period == 'P.M.' and hours < 12:
        hours += 12
    if period == 'A.M.' and hours == 12:
        hours = 0

    return datetime(year, month, day, hours, minutes)


def calculate_on_time(service_level, ship_date_str, ship_time_str, delivery_date_str, delivery_time_str):
    service_details = service_levels.get(service_level)
    if not service_details:
        raise ValueError('Invalid service level')

    earliest = parse_date_time(delivery_date_str, service_details['earliest'])
    latest = parse_date_time(delivery_date_str, service_details['latest'])
    ship_date = parse_date_time(ship_date_str, ship_time_str)
    delivery_date = parse_date_time(delivery_date_str, delivery_time_str)

    ship_day = ship_date.weekday()
    adjusted_days_limit = service_details['daysLimit']

    if ship_day == 4:  # Friday
        adjusted_days_limit += 2
    elif ship_day == 5:  # Saturday
        adjusted_days_limit += 1

    delivery_ship_date_diff = (delivery_date - ship_date).days

    if delivery_ship_date_diff > adjusted_days_limit:
        return "No"
    elif delivery_date < earliest:
        return "Yes"
    elif earliest <= delivery_date <= latest:
        return "Research"
    elif delivery_date > latest:
        return "No"

    return "Research"


def safe_eval_with_timeout(driver, selector, eval_callback, timeout=10):
    try:
        driver.implicitly_wait(timeout)
        element = driver.find_element(By.CSS_SELECTOR, selector)
        return eval_callback(element)
    except Exception:
        return None


def write_csv(file_path, data):
    fieldnames = data[0].keys()
    file_exists = False

    try:
        with open(file_path, mode='r', newline='', encoding='utf-8') as file:
            file_exists = True
    except FileNotFoundError:
        pass

    with open(file_path, mode='a', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(data)


def read_csv(file_path):
    rows = []
    try:
        with open(file_path, mode='r', newline='', encoding='utf-8') as file:
            reader = csv.DictReader(file)
            for row in reader:
                rows.append(row)
    except FileNotFoundError:
        pass
    return rows


def is_row_processed(tracking_number):
    existing_data = read_csv(output_csv_file)
    return any(row["Ship Date"] and row["Airbill Number/BOL Number"] == tracking_number for row in existing_data)


def process_data():
    data = read_csv(input_csv_file)

    chrome_options = Options()
    # chrome_options.add_argument("--headless")  # Run in headless mode
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
    driver.get("https://www.ups.com/track")

    cookie_button = driver.find_element(By.CSS_SELECTOR, ".implicit_privacy_prompt > .close_btn_thick")
    cookie_button.click()

    error_found = False
    messaging_box_closed = False
    started = False

    for i, row in enumerate(data):
        tracking_number = row.get("Airbill Number/BOL Number")
        
        if not tracking_number or is_row_processed(tracking_number):
            continue

        try:
            if not error_found:
                if started:
                    track_again_input = driver.find_element(By.ID, "stApp_trackAgain_trackingNumEntry")
                    track_again_input.clear()
                    track_again_input.send_keys(tracking_number)
                    track_again_button = driver.find_element(By.ID, "stApp_trackAgain_getTrack")
                    track_again_button.click()
                else:
                    tracking_input = driver.find_element(By.ID, "stApp_trackingNumber")
                    tracking_input.send_keys(tracking_number)
                    track_button = driver.find_element(By.ID, "stApp_btnTrack")
                    track_button.click()
                    started = True
            else:
                tracking_input = driver.find_element(By.ID, "stApp_trackingNumber")
                tracking_input.clear()
                tracking_input.send_keys(tracking_number)
                track_button = driver.find_element(By.ID, "stApp_btnTrack")
                track_button.click()

                error_found = False

            error = safe_eval_with_timeout(
                driver,
                "#stApp_error_alert_list0",
                lambda el: el.text.strip() if el else None,
                5
            )

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

            driver.implicitly_wait(20)
            ship_date_time = driver.find_element(By.ID, "stApp_milestoneDateTime1").text.strip() if driver.find_elements(By.ID, "stApp_milestoneDateTime1") else None
            ship_date, ship_time = (ship_date_time.split(",") if ship_date_time else [None, None])

            delivery_date_time = driver.find_element(By.ID, "stApp_milestoneDateTime4").text.strip() if driver.find_elements(By.ID, "stApp_milestoneDateTime4") else None
            delivery_date, delivery_time = (delivery_date_time.split(",") if delivery_date_time else [None, None])

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

            driver.implicitly_wait(10)
            driver.find_element(By.ID, "st_App_View_Details").click()

            weather_details = safe_eval_with_timeout(
                driver,
                ".ups-tab-content.top-tab",
                lambda el: "Yes" if "weather" in el.text.lower() else "No",
                10
            )

            service_level = row["Service Level"]

            print(ship_date, ship_time, delivery_date, delivery_time, weather_details, service_level)

            on_time = calculate_on_time(service_level, ship_date, ship_time, delivery_date, delivery_time)

            row["Ship Date"] = ship_date or "SCRIPT_ERROR"
            row["Delivery Date"] = delivery_date or "SCRIPT_ERROR"
            row["Delivery Time"] = delivery_time or "SCRIPT_ERROR"
            row["On Time?"] = on_time or "SCRIPT_ERROR"
            row["Weather?"] = weather_details or "SCRIPT_ERROR"

            write_csv(output_csv_file, [row])

            driver.find_element(By.CSS_SELECTOR, ".modal-content > .modal-header > .close").click()
            time.sleep(2)

        except Exception as error:
            print(f"Error processing tracking number {tracking_number}:", error)
            # print(error)
            row["Ship Date"] = "SCRIPT_ERROR"
            row["Delivery Date"] = "SCRIPT_ERROR"
            row["Delivery Time"] = "SCRIPT_ERROR"
            row["On Time?"] = "SCRIPT_ERROR"
            row["Weather?"] = "SCRIPT_ERROR"
            write_csv(output_csv_file, [row])

    driver.quit()


if __name__ == "__main__":
    try:
        process_data()
        print("CSV updated successfully!")
    except Exception as e:
        print("Error:", e)

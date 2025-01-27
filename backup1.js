const puppeteer = require("puppeteer");
const fs = require("fs");
const csvParser = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");
const { calculateOnTime } = require("./helpers");

// Input/Output CSV file
const csvFile = "shipment export with additional columns.csv";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Path to the Brave browser executable (adjust the path as per your system)
const bravePath = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

// Function to read the CSV
async function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on("data", (row) => rows.push(row))
            .on("end", () => resolve(rows))
            .on("error", reject);
    });
}

// Function to write the updated CSV
async function writeCSV(filePath, data) {
    const headers = Object.keys(data[0]);
    const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: headers.map((header) => ({ id: header, title: header })),
    });
    await csvWriter.writeRecords(data);
}

async function safeEvalWithTimeout(page, selector, evalCallback, timeout = 5000) {
    try {
        await page.waitForSelector(selector, { timeout });

        return await page.$eval(selector, evalCallback);
    } catch (error) {
        return null;
    }
}

// Function to process data and interact with UPS
async function processData() {
    const data = await readCSV(csvFile);

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: bravePath, // Use Brave browser
    });
    const page = await browser.newPage();

    // Navigate to UPS tracking page once at the start
    await page.goto("https://www.ups.com/track");

    await page.waitForSelector(".implicit_privacy_prompt", { timeout: 10000 });
    await page.click(".implicit_privacy_prompt > .close_btn_thick");

    await page.waitForSelector("#stApp_trackingNumber", { timeout: 10000 });

    let errorFound = false;
    let messagingBoxClosed = false;

    for (let i = 0; i < data.length; i++) {
        const trackingNumber = data[i]["Airbill Number/BOL Number"];

        if (!trackingNumber) continue;

        try {
            if (!errorFound) {
                if (i !== 0) {
                    // For subsequent rows, use the second input field to enter tracking number again
                    await page.waitForSelector("#stApp_trackAgain_trackingNumEntry", { timeout: 10000 });
                    await page.type("#stApp_trackAgain_trackingNumEntry", trackingNumber);
                    // await page.waitForSelector("#stApp_trackAgain_getTrack", { timeout: 10000 });
                    await page.click("#stApp_trackAgain_getTrack");

                    // Wait for the tracking results container to load
                    // await page.waitForSelector(".ups-card_content", { timeout: 20000 });
                } else {
                    // First row, use the initial input field and submit
                    await page.type("#stApp_trackingNumber", trackingNumber);
                    // await page.type("#stApp_trackingNumber", 'trackingNumber');
                    await page.click("#stApp_btnTrack");

                    // Wait for the tracking results container to load
                    // await page.waitForSelector(".ups-card_content", { timeout: 20000 });
                }
            } else {
                await page.waitForSelector("#stApp_trackingNumber", { timeout: 10000 });
                await page.focus("#stApp_trackingNumber");
                await page.keyboard.down("Control");
                await page.keyboard.press("A");
                await page.keyboard.up("Control");
                await page.keyboard.press("Backspace");
                await page.type("#stApp_trackingNumber", trackingNumber);
                await page.click("#stApp_btnTrack");

                errorFound = false;

                // Wait for the tracking results container to load
                // await page.waitForSelector(".ups-card_content", { timeout: 20000 });
            }

            const error = await safeEvalWithTimeout(
                page,
                "#stApp_error_alert_list0",
                (el) => el.innerText.trim(),
                5000
            );

            if (error) {
                console.log(`Error for tracking number ${trackingNumber}: ${error}`);
                errorFound = true;
                continue;
            }

            await page.waitForSelector(".ups-strack_tracking", { timeout: 20000 });

            // Extract dates and times
            const shipDateAndTime = await page.$eval("#stApp_milestoneDateTime1", (el) => el.innerText.trim()).catch(() => null);
            const shipDate = shipDateAndTime?.split(",")[0]?.trim();
            const shipTime = shipDateAndTime?.split(",")[1]?.trim();

            const deliveryDateAndTime = await page.$eval("#stApp_milestoneDateTime4", (el) => el.innerText.trim()).catch(() => null);
            const splittedDeliveryDateAndTime = deliveryDateAndTime?.split(",");
            const deliveryDate = splittedDeliveryDateAndTime?.[0]?.trim();
            const deliveryTime = splittedDeliveryDateAndTime?.[1]?.trim();

            if (!messagingBoxClosed) {

                // await wait(5000)

                await page.waitForSelector('#nuanMessagingFrame > iframe[src*="nuance-chat.html"]', { timeout: 10000 });
                const chatboxFrame = await page.$('#nuanMessagingFrame > iframe[src*="nuance-chat.html"]');

                if (chatboxFrame) {
                    // Get the iframe content
                    const frame = await chatboxFrame.contentFrame();

                    if (frame) {
                        // Wait for the close button in the iframe and click it
                        await frame.waitForSelector(".top-bar-item.icon", { timeout: 5000 });
                        await frame.click(".top-bar-item.icon");
                        // console.log("Chatbox closed.");
                    }
                }

                messagingBoxClosed = true;

            }

            await page.waitForSelector("#st_App_View_Details", { timeout: 10000 });
            await page.click("#st_App_View_Details");

            // Search for "weather" in shipping details
            const weatherDetails = await page.$eval(".ups-tab-content.top-tab", (el) =>
                /weather/i.test(el.innerText) ? "Yes" : "No"
            ).catch(() => null);

            const serviceLevel = data[i]["Service Level"];

            const onTime = calculateOnTime(serviceLevel, shipDate, shipTime, deliveryDate, deliveryTime, serviceLevel);

            console.log(shipDate, shipTime, deliveryDate, deliveryTime, weatherDetails, serviceLevel, onTime);
            // console.log(shipTime);
            // console.log(deliveryDate);
            // console.log(deliveryTime);
            // console.log(weatherDetails);
            // console.log(serviceLevel);
            // console.log(onTime);

            await page.waitForSelector(".modal-content > .modal-header > .close", { timeout: 10000 });
            await page.click(".modal-content > .modal-header > .close");

            await wait(2000);

        } catch (error) {
            console.error(`Error processing tracking number ${trackingNumber}:`, error);
        }
    }

    await browser.close();

    // Write updated data to the CSV
    await writeCSV(csvFile, data);
}

// Execute the script
processData()
    .then(() => console.log("CSV updated successfully!"))
    .catch((error) => console.error("Error:", error));

const puppeteer = require("puppeteer");
const fs = require("fs");
const csvParser = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");
// const { calculateOnTime } = require("./helpers");

const inputCsvFile = "shipment export with additional columns.csv";
const outputCsvFile = "output.csv";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bravePath = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

const serviceLevels = {
    'Next Day Air Early AM': { earliest: '8:00 A.M.', latest: '9:30 A.M.', daysLimit: 1 },
    'Next Day Air': { earliest: '10:30 A.M.', latest: '12:00 P.M.', daysLimit: 1 },
    'Next Day Air Saver': { earliest: '3:00 P.M.', latest: '11:59 P.M.', daysLimit: 1 },
    '2nd Day Air AM': { earliest: '10:30 A.M.', latest: '12:00 P.M.', daysLimit: 2 },
    '2nd Day Air': { earliest: '1:00 P.M.', latest: '11:59 P.M.', daysLimit: 2 }
};

function calculateOnTime(serviceLevel, shipDateStr, shipTimeStr, deliveryDateStr, deliveryTimeStr) {
    function parseDateTime(dateStr, timeStr) {
        const dateParts = dateStr.split('/');
        const timeParts = timeStr.split(' ');

        const [month, day, year] = dateParts.map(Number);
        let [hours, minutes] = timeParts[0].split(':').map(Number);
        const period = timeParts[1].toUpperCase(); // AM or PM

        if (period === 'P.M.' && hours < 12) {
            hours += 12; // Convert PM times to 24-hour format
        }
        if (period === 'A.M.' && hours === 12) {
            hours = 0; // Midnight case
        }

        return new Date(year, month - 1, day, hours, minutes);
    }

    const shipDate = parseDateTime(shipDateStr, shipTimeStr);
    const deliveryDate = parseDateTime(deliveryDateStr, deliveryTimeStr);

    const serviceDetails = serviceLevels[serviceLevel];

    if (!serviceDetails) {
        throw new Error('Invalid service level');
    }

    const { earliest, latest, daysLimit } = serviceDetails;

    const earliestTime = parseDateTime(deliveryDateStr, earliest);
    const latestTime = parseDateTime(deliveryDateStr, latest);

    const shipDay = shipDate.getDay();
    let adjustedDaysLimit = daysLimit;

    if (shipDay === 5) {
        adjustedDaysLimit += 2; // Ship date is Friday, add 2 days
    } else if (shipDay === 6) {
        adjustedDaysLimit += 1; // Ship date is Saturday, add 1 day
    }

    const deliveryShipDateDiff = (deliveryDate - shipDate) / (1000 * 3600 * 24); // Difference in days

    // Determine "On Time" status
    if (deliveryShipDateDiff > adjustedDaysLimit) {
        return "No";
    } else if (deliveryDate < earliestTime) {
        return "Yes";
    } else if (deliveryDate >= earliestTime && deliveryDate <= latestTime) {
        return "Research";
    } else if (deliveryDate > latestTime) {
        return "No";
    }

    return "Research";
}

async function safeEvalWithTimeout(page, selector, evalCallback, timeout = 5000) {
    try {
        await page.waitForSelector(selector, { timeout });

        return await page.$eval(selector, evalCallback);
    } catch (error) {
        return null;
    }
}

async function writeCSV(filePath, data) {
    const headers = Object.keys(data[0]);

    const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: headers.map((header) => ({ id: header, title: header })),
        append: true
    });

    if (!fs.existsSync(filePath)) {
        const writer = createObjectCsvWriter({
            path: filePath,
            header: headers.map((header) => ({ id: header, title: header })),
        });
        await writer.writeRecords(data);
    } else {
        await csvWriter.writeRecords(data);
    }
}


async function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return resolve(rows);
        }
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on("data", (row) => rows.push(row))
            .on("end", () => resolve(rows))
            .on("error", reject);
    });
}

async function isRowProcessed(trackingNumber) {
    const existingData = await readCSV(outputCsvFile);
    return existingData.some(row => row["Ship Date"] && row["Airbill Number/BOL Number"] === trackingNumber);
}

async function processData() {
    const data = await readCSV(inputCsvFile);
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: bravePath,
    });
    const page = await browser.newPage();

    await page.goto("https://www.ups.com/track");

    await page.waitForSelector(".implicit_privacy_prompt", { timeout: 10000 });
    await page.click(".implicit_privacy_prompt > .close_btn_thick");

    await page.waitForSelector("#stApp_trackingNumber", { timeout: 10000 });

    let errorFound = false;
    let messagingBoxClosed = false;
    let started = false;

    for (let i = 0; i < data.length; i++) {
        const trackingNumber = data[i]["Airbill Number/BOL Number"];

        if (!trackingNumber || await isRowProcessed(trackingNumber)) continue;

        try {
            if (!errorFound) {
                if (started) {
                    await page.waitForSelector("#stApp_trackAgain_trackingNumEntry", { timeout: 10000 });
                    await page.type("#stApp_trackAgain_trackingNumEntry", trackingNumber);
                    await page.click("#stApp_trackAgain_getTrack");
                } else {
                    await page.type("#stApp_trackingNumber", trackingNumber);
                    await page.click("#stApp_btnTrack");
                    started = true;
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
            }

            const error = await safeEvalWithTimeout(
                page,
                "#stApp_error_alert_list0",
                (el) => el.innerText.trim(),
                5000
            );

            if (error) {
                console.log(`Error for tracking number ${trackingNumber}: ${error}`);
                data[i]["Ship Date"] = "SCRIPT_ERROR";
                data[i]["Delivery Date"] = "SCRIPT_ERROR";
                data[i]["Delivery Time"] = "SCRIPT_ERROR";
                data[i]["On Time?"] = "SCRIPT_ERROR";
                data[i]["Weather?"] = "SCRIPT_ERROR";
                await writeCSV(outputCsvFile, [data[i]]);
                errorFound = true;
                continue;
            }

            await page.waitForSelector(".ups-strack_tracking", { timeout: 20000 });

            const shipDateAndTime = await page.$eval("#stApp_milestoneDateTime1", (el) => el.innerText.trim()).catch(() => null);
            const shipDate = shipDateAndTime?.split(",")[0]?.trim();
            const shipTime = shipDateAndTime?.split(",")[1]?.trim();

            const deliveryDateAndTime = await page.$eval("#stApp_milestoneDateTime4", (el) => el.innerText.trim()).catch(() => null);
            const splittedDeliveryDateAndTime = deliveryDateAndTime?.split(",");
            const deliveryDate = splittedDeliveryDateAndTime?.[0]?.trim();
            const deliveryTime = splittedDeliveryDateAndTime?.[1]?.trim();

            if (!messagingBoxClosed) {
                await page.waitForSelector('#nuanMessagingFrame > iframe[src*="nuance-chat.html"]', { timeout: 10000 });
                const chatboxFrame = await page.$('#nuanMessagingFrame > iframe[src*="nuance-chat.html"]');

                if (chatboxFrame) {
                    const frame = await chatboxFrame.contentFrame();
                    if (frame) {
                        await frame.waitForSelector(".top-bar-item.icon", { timeout: 5000 });
                        await frame.click(".top-bar-item.icon");
                    }
                }

                messagingBoxClosed = true;
            }

            await page.waitForSelector("#st_App_View_Details", { timeout: 10000 });
            await page.click("#st_App_View_Details");

            const weatherDetails = await page.$eval(".ups-tab-content.top-tab", (el) =>
                /weather/i.test(el.innerText) ? "Yes" : "No"
            ).catch(() => null);

            const serviceLevel = data[i]["Service Level"];
            const onTime = calculateOnTime(serviceLevel, shipDate, shipTime, deliveryDate, deliveryTime, serviceLevel);

            console.log(shipDate, shipTime, deliveryDate, deliveryTime, weatherDetails, serviceLevel, onTime);

            data[i]["Ship Date"] = shipDate || "SCRIPT_ERROR";
            data[i]["Delivery Date"] = deliveryDate || "SCRIPT_ERROR";
            data[i]["Delivery Time"] = deliveryTime || "SCRIPT_ERROR";
            data[i]["On Time?"] = onTime || "SCRIPT_ERROR";
            data[i]["Weather?"] = weatherDetails || "SCRIPT_ERROR";

            await writeCSV(outputCsvFile, [data[i]]);

            await page.waitForSelector(".modal-content > .modal-header > .close", { timeout: 10000 });
            await page.click(".modal-content > .modal-header > .close");

            await wait(2000);

        } catch (error) {
            console.error(`Error processing tracking number ${trackingNumber}:`, error);
            data[i]["Ship Date"] = "SCRIPT_ERROR";
            data[i]["Delivery Date"] = "SCRIPT_ERROR";
            data[i]["Delivery Time"] = "SCRIPT_ERROR";
            data[i]["On Time?"] = "SCRIPT_ERROR";
            data[i]["Weather?"] = "SCRIPT_ERROR";
            await writeCSV(outputCsvFile, [data[i]]);
        }
    }

    await browser.close();
}

processData()
    .then(() => console.log("CSV updated successfully!"))
    .catch((error) => console.error("Error:", error));

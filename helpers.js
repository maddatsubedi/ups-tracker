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

module.exports = {
    calculateOnTime
};
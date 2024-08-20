const AWS = require('aws-sdk');
const S3DB = require('@dwkerwin/s3db');
const config = require('./config');
const moment = require('moment-timezone');
const createLogger = require('./logger');
let logger = createLogger();

async function process(event) {
    logger.debug('Starting notification submitter');

    try {
        logger.debug(`Processing raw event: ${JSON.stringify(event, null, 2)}`);
        // there isn't any "time" property of the event, the event is just the
        // cron without any useful information in the event, but our testing code
        // relies on it, so try to use this property and if it isn't found,
        // default to the current time
        let eventTime;
        try {
            eventTime = new Date(event.time);
            if (isNaN(eventTime)) throw new Error('Invalid date');
            logger.debug(`Event time obtained from event (TESTING USE CASE ONLY): ${eventTime.toISOString()} UTC (${eventTime.toLocaleString("en-US", {timeZone: "America/New_York"})} EST)`);
        } catch (error) {
            eventTime = new Date();
            logger.debug(`Event time obtained from system: ${eventTime.toISOString()} UTC (${eventTime.toLocaleString("en-US", {timeZone: "America/New_York"})} EST)`);
        }

        let timeSlots = [];
        timeSlots.push(determineTimeSlotFromEventTime(eventTime));

        let totalSubmitted = 0, totalDeleted = 0;
        for (const timeSlot of timeSlots) {
            let { numSubmitted, numDeleted } = await processTimeSlot(timeSlot);
            totalSubmitted += numSubmitted;
            totalDeleted += numDeleted;
        }
        logger.info(`Total notifications submitted: ${totalSubmitted}, total notifications deleted: ${totalDeleted}`);
        return { totalSubmitted, totalDeleted };
    }
    catch (err) {
        logger.error(`Error in notification submitter: ${err.name} - ${err.message}\nStack trace: ${err.stack}\nEvent: ${JSON.stringify(event, null, 2)}`);
        throw err;
    }
}

async function processTimeSlot(timeSlot) {
    logger.trace(`Processing notifications in time slot: ${timeSlot} (${convertUtcTimeSlotStringToEst(timeSlot)})`);
    const notificationsInTimeSlot = await getNotificationsInTimeSlot(timeSlot);
    logger.info(`Processing ${notificationsInTimeSlot.length} notifications in time slot ${timeSlot}`);

    let numSubmitted = 0, numDeleted = 0;
    for (const notificationKey of notificationsInTimeSlot) {
        let { wasSubmitted, wasDeleted } = await processTimeSlotItem(notificationKey, timeSlot);
        if (wasSubmitted) numSubmitted++;
        if (wasDeleted) numDeleted++;
    }
    return { numSubmitted, numDeleted }
}

async function processTimeSlotItem(notificationKey, timeSlot) {
    logger.info(`Processing notification: ${notificationKey} from timeslot ${timeSlot} (${convertUtcTimeSlotStringToEst(timeSlot)})`);

    logger.info(`Checking notification: ${notificationKey} from timeslot ${timeSlot} (${convertUtcTimeSlotStringToEst(timeSlot)})`);
    const s3db = new S3DB(config.NOTIFICATION_BUCKET, `notifications/slots/${timeSlot}`);
    const notificationObj = await s3db.get(notificationKey);
    let wasSubmitted = false, wasDeleted = false;
    const correlationId = `${notificationObj.uniqueProperties.userId}-${notificationObj.uniqueProperties.messageId}`;
    logger = createLogger(correlationId);

    // Assuming notificationObj has a 'date' property in 'YYYY-MM-DD' format
    const notificationDate = moment.utc(notificationObj.date);
    const currentDate = moment.utc().startOf('day');
    const isToday = notificationDate.isSame(currentDate, 'day');

    if (!isToday) {
        // If the notification is for a future date, log and return
        logger.info(`Notification ${notificationKey} is scheduled for a future date: ${notificationDate.format('YYYY-MM-DD')}. Skipping for now.`);
        return { wasSubmitted: false, wasDeleted: false };
    }
    
    // post to the processor SNS topic
    const sns = new AWS.SNS({ region: config.AWS_REGION });
    const params = {
        Message: JSON.stringify(notificationObj),
        TopicArn: config.NOTIFICATION_PROCESSOR_TOPIC_ARN
    };
    await sns.publish(params).promise();
    logger.debug(`Message posted to SNS topic: ${config.NOTIFICATION_PROCESSOR_TOPIC_ARN}, message: ${params.Message}`);

    // if it is a one-time notification, delete it
    if (notificationObj.scheduleType === 'one-time') {
        logger.debug(`Deleting one-time notification: ${notificationKey}`);
        await s3db.delete(notificationKey);
        wasDeleted = true;
    }

    // reset the correlationId, anything done after this point will not be
    // associated with the current correlationId
    logger = createLogger(null);

    wasSubmitted = true;
    return { wasSubmitted, wasDeleted };
}

async function getNotificationsInTimeSlot(timeSlot) {
    const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'notifications/slots');
    const subPath = `${timeSlot}/`;
    logger.debug(`Listing notifications in s3://${config.NOTIFICATION_BUCKET}/notifications/slots/${subPath}*`);
    let notifications = [];
    try {
        notifications = await s3db.list(subPath);
    } catch (error) {
        console.error(`Failed to get notifications in time slot ${timeSlot}: ${error.message}`);
    }
    return notifications;
}

function getTimeSlotFromDateStr(dateStr) {
    const sendTime = new Date(dateStr);
    const hours = sendTime.getUTCHours().toString().padStart(2, '0');
    const minutes = sendTime.getUTCMinutes().toString().padStart(2, '0');
    const timeSlot = `${hours}-${minutes}`;
    logger.trace(`Retrieved timeSlot=${timeSlot} from dateStr=${dateStr}`);
    return timeSlot;
}

function determineTimeSlotFromEventTime(eventTime) {
    if (!(eventTime instanceof Date)) {
        const errMsg = `determineTimeSlotFromEventTime - Invalid eventTime. Expected a Date object. eventTime=${eventTime}`;
        logger.error(errMsg);
        throw new Error(errMsg);
    }
    const eventTimeUtc = eventTime.toISOString();
    const timeSlot = getTimeSlotFromDateStr(eventTimeUtc);
    const adjustedTimeSlot = roundTimeSlotToNearest(timeSlot, 5);
    logger.debug(`Adjusted time slot from ${timeSlot} (raw event time) to ${adjustedTimeSlot} (${convertUtcTimeSlotStringToEst(adjustedTimeSlot)})`);
    return adjustedTimeSlot;
}

function roundTimeSlotToNearest(timeSlot, minuteParts) {
    const parts = timeSlot.split('-');
    const hours = parts[0];
    const minutes = parts[1];
    const minutesRounded = Math.round(minutes / minuteParts) * minuteParts;
    const timeSlotRounded = `${hours}-${minutesRounded.toString().padStart(2, '0')}`;
    return timeSlotRounded;
}

// takes a time slot string in the format "HH-MM" and returns a string in
// the format "hh:mm A EST", for log readability only
function convertUtcTimeSlotStringToEst(timeSlotStr) {
    try {
        const [hours, minutes] = timeSlotStr.split('-').map(Number);
        const utcMoment = moment.utc().set({ hour: hours, minute: minutes, second: 0 });
        const estTimeString = utcMoment.tz('America/New_York').format('hh:mm A');

        return estTimeString + ' EST';
    } catch (err) {
        console.error(`Error in convertUtcTimeSlotStringToEst: ${err}`);
        throw err;
    }
}

module.exports.handler = process;

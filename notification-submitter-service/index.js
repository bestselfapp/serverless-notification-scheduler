const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');
const Joi = require('joi');

async function processTimeSlot(event) {
    logger.debug('Starting notification submitter');

    try {
        logger.trace(`Processing raw event: ${JSON.stringify(event, null, 2)}`);
        // there isn't any "time" property of the event, there isn't any useful
        // information in the event, but our testing code relies on it
        // so try to use this property and if it isn't found, default to the
        // current time
        let eventTime;
        try {
            eventTime = new Date(event.time);
            if (isNaN(eventTime)) throw new Error('Invalid date');
            logger.debug(`Event time obtained from event: ${eventTime.toISOString()} UTC (${eventTime.toLocaleString("en-US", {timeZone: "America/New_York"})} EST)`);
        } catch (error) {
            eventTime = new Date();
            logger.debug(`Event time obtained from system: ${eventTime.toISOString()} UTC (${eventTime.toLocaleString("en-US", {timeZone: "America/New_York"})} EST)`);
        }
        const timeSlot = determineTimeSlotFromEventTime(eventTime);
        logger.trace(`Processing notifications in time slot: ${timeSlot} ()`);
        const notificationsInTimeSlot = await getNotificationsInTimeSlot(timeSlot);
        logger.info(`Processing ${notificationsInTimeSlot.length} notifications in time slot ${timeSlot}`);

        let notificationsSubmitted = 0;
        let notificationsDeleted = 0;
        for (const notificationKey of notificationsInTimeSlot) {
            logger.debug(`Processing notification: ${notificationKey}`);
            const s3db = new S3DB(config.NOTIFICATION_BUCKET, `notifications/slots/${timeSlot}`);
            const notificationObj = await s3db.get(notificationKey);
            // post to the processor SNS topic
            const sns = new AWS.SNS({ region: config.AWS_REGION });
            const params = {
                Message: JSON.stringify(notificationObj),
                TopicArn: config.NOTIFICATION_PROCESSOR_TOPIC_ARN
            };
            await sns.publish(params).promise();
            logger.trace(`Message posted to SNS topic: ${config.NOTIFICATION_PROCESSOR_TOPIC_ARN}, message: ${params.Message}`);

            // if it is a one-time notification, delete it
            if (notificationObj.scheduleType === 'one-time') {
                logger.debug(`Deleting one-time notification: ${notificationKey}`);
                await s3db.delete(notificationKey);
                notificationsDeleted++;
            }

            notificationsSubmitted++;
        }
        return { notificationsSubmitted, notificationsDeleted };
    }
    catch (err) {
        logger.error(`Error in notification submitter: ${err.name} - ${err.message}`);
        logger.error(`Stack trace: ${err.stack}`);
        logger.error(`Event: ${JSON.stringify(event, null, 2)}`);
        throw err;
    }
}

async function getNotificationsInTimeSlot(timeSlot) {
    const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'notifications/slots');
    const subPath = `${timeSlot}/`;
    logger.debug(`Listing notifications in s3://${config.NOTIFICATION_BUCKET}/notifications/slots/${subPath}/*`);
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
    logger.debug(`Adjusted time slot from ${timeSlot} (raw event time) to ${adjustedTimeSlot}`);
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

module.exports.handler = processTimeSlot;

const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');
const Joi = require('joi');
const processSms = require('./processSms');
const processPush = require('./processPush');

async function processNotification(event) {
    logger.debug('Starting notification processor');

    try {
        // event is passed as an object
        logger.trace(`Raw event:\n${JSON.stringify(event, null, 2)}`);
        
        logger.info(`Processing ${event.notificationType} notification for user ${event.uniqueProperties.userId}, messageId: ${event.uniqueProperties.messageId}`);

        // validate the message
        // message format, see: ./events/validSmsNotification.json

        // TODO: process the callbacks here for adaptive message & timing

        if (event.notificationType == 'push') {
            await processPush(event);
        } else if (event.notificationType == 'sms') {
            await processSms(event);
        } else {
            const errMsg = `Invalid notification type: ${event.notificationType} for user ${event.uniqueProperties.userId}, messageId: ${event.uniqueProperties.messageId}`;
            logger.error(errMsg);
            throw new Error(errMsg);
        }

        // TODO: log transcript to S3

        logger.info(`Successfully sent notification for user ${event.uniqueProperties.userId}, messageId: ${event.uniqueProperties.messageId}`);
    }
    catch (err) {
        logger.error(`Error in notification processor: ${err}`);
        throw err;
    }
};


module.exports.handler = processNotification;

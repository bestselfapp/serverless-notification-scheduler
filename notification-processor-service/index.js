const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');
const Joi = require('joi');

async function processNotification(event) {
    logger.debug('Starting notification processor');

    try {

        const message = JSON.parse(event.Records[0].Sns.Message);

    }
    catch (err) {
        logger.error(`Error in notification processor: ${err}`);
        throw err;
    }
};


module.exports.handler = processNotification;

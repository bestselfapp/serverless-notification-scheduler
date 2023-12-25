const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');

async function processNotification(event) {
    logger.debug('Starting notification scheduler');

    try {

        const message = JSON.parse(event.Records[0].Sns.Message);

        // find the time slot for the notification

        // if there is an adaptive time callback, call it and update the time slot

        // generate the hash of the unique properties of the notification

        // check if the unique hash exists in any time slot folder

        // if it does, delete the existing notification

        // save the notification to the time slot folder

        // Put the notification request in an S3 structure by time slot
        // const params = {
        //   Bucket: 'bsa-pdata-dev-us-east-1',
        //   Key: `notifications/slots/${message.sendTimeUtc}/${message.uniqueProperties.message.title}.json`,
        //   Body: JSON.stringify(message),
        // };

        // await s3.putObject(params).promise();
    }
    catch (err) {
        logger.error(`Error in notification scheduler: ${err}`);
        throw err;
    }
};

module.exports.handler = handler

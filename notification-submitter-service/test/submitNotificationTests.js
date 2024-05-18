const expect = require('chai').expect;
const testHelpers = require('./testHelpers');
const { handler } = require('../index');
const AWS = require('aws-sdk');
const config = require('../config');
const S3DB = require('@dwkerwin/s3db');
const s3db = new S3DB('bsa-notifications-dev-us-east-1', 'notifications/slots');
const createLogger = require('../logger');
let logger = createLogger();

describe('Notification Submitter', function() {
    this.timeout(20000); // Setting global timeout to 20 seconds

    it('should process a time slot with no notifications in it without error', async function() {
        let event = {
            "time": "2024-01-01T12:45:00.000Z"
        };

        let returnObj = await handler(event);
        expect(returnObj.totalSubmitted).to.equal(0);
        expect(returnObj.totalDeleted).to.equal(0);
    });

    it('should process a time slot with recurring notifications', async function() {
        let event = {
            "time": "2024-01-01T12:50:00.000Z"
        };

                // post new one-time notification schedule requests to the SNS topic
        // for the notifications scheduler
        const scheduleNotificationMessage = 
            {
                "uniqueProperties": {
                    "userId": "12345",
                    "messageId": "dailyReminder",
                },
                "message": {
                    "title": "BestSelfApp",
                    "subtitle": "",
                    "body": "Enter today's data! (test message)",
                    "messageContentCallbackUrl": ""
                },
                "scheduleType": "recurring",
                "notificationType": "sms",
                "pushNotificationSettings": {
                    "appleSettings": {
                        "deviceToken": "deviceTokenHere",
                        "credentials": "notSureWhatGoesHere"
                    }
                },
                "smsNotificationSettings": {
                    "phoneNumber": "6092734392"
                },
                "sendTimeUtc": "2024-01-01T12:50:00.000Z",
                "enableAdaptiveTiming": false,
                "adaptiveTimingCallbackUrl": ""
            };
        const sns = new AWS.SNS({ region: config.AWS_REGION });
        const params = {
            Message: JSON.stringify(scheduleNotificationMessage),
            TopicArn: 'arn:aws:sns:us-east-1:805071920706:bsa-notification-scheduler'
        };
        logger.debug('Posting notification schedule one-time notification request to SNS topic')
        await sns.publish(params).promise();
        
        // give the scheduler a chance to process the notification
        logger.debug('Sleeping to allow scheduler to process notification');
        await new Promise(resolve => setTimeout(resolve, 5000));

        let returnObj = await handler(event);
        expect(returnObj.totalSubmitted).to.be.greaterThan(0);
        expect(returnObj.totalDeleted).to.equal(0);

        // cleanup
        await s3db.delete(`12-50/12345-dailyReminder`);
    });

    it('should process a time slot with one-time notifications, deleting them afterwards', async function() {
        let event = {
            "time": "2024-01-01T12:55:00.000Z"
        };

        // post new one-time notification schedule requests to the SNS topic
        // for the notifications scheduler
        const scheduleNotificationMessage = 
            {
                "uniqueProperties": {
                    "userId": "12345",
                    "messageId": "morningPredictionWarning",
                },
                "message": {
                    "title": "BestSelfApp",
                    "subtitle": "",
                    "body": "Be careful, today you typically have events that hurt your goals! (test message)",
                    "messageContentCallbackUrl": ""
                },
                "scheduleType": "one-time",
                "notificationType": "sms",
                "pushNotificationSettings": {
                    "appleSettings": {
                        "deviceToken": "deviceTokenHere",
                        "credentials": "notSureWhatGoesHere"
                    }
                },
                "smsNotificationSettings": {
                    "phoneNumber": "6092734392"
                },
                "sendTimeUtc": "2024-01-01T12:55:00.000Z",
                "enableAdaptiveTiming": false,
                "adaptiveTimingCallbackUrl": ""
            };
        const sns = new AWS.SNS({ region: config.AWS_REGION });
        const params = {
            Message: JSON.stringify(scheduleNotificationMessage),
            TopicArn: 'arn:aws:sns:us-east-1:805071920706:bsa-notification-scheduler'
        };
        logger.debug('Posting notification schedule one-time notification request to SNS topic')
        await sns.publish(params).promise();
        
        // give the scheduler a chance to process the notification
        logger.debug('Sleeping to allow scheduler to process notification');
        await new Promise(resolve => setTimeout(resolve, 5000));

        let returnObj = await handler(event);
        expect(returnObj.totalSubmitted).to.equal(1);
        expect(returnObj.totalDeleted).to.equal(1);

        // cleanup
        await s3db.delete(`12-55/12345-morningPredictionWarning`);
    });

    it('should process a notification in the now time slot', async function() {
        let event = {
            "time": "now"
        };

        // post new one-time notification schedule requests to the SNS topic
        // for the notifications scheduler
        const scheduleNotificationMessage = 
            {
                "uniqueProperties": {
                    "userId": "12345",
                    "messageId": "nowNotification",
                },
                "message": {
                    "title": "BestSelfApp",
                    "subtitle": "",
                    "body": "This is a test message for the 'now' time slot",
                    "messageContentCallbackUrl": ""
                },
                "scheduleType": "one-time",
                "notificationType": "sms",
                "pushNotificationSettings": {
                    "appleSettings": {
                        "deviceToken": "deviceTokenHere",
                        "credentials": "notSureWhatGoesHere"
                    }
                },
                "smsNotificationSettings": {
                    "phoneNumber": "6092734392"
                },
                "sendTimeUtc": "now",
                "enableAdaptiveTiming": false,
                "adaptiveTimingCallbackUrl": ""
            };
        const sns = new AWS.SNS({ region: config.AWS_REGION });
        const params = {
            Message: JSON.stringify(scheduleNotificationMessage),
            TopicArn: 'arn:aws:sns:us-east-1:805071920706:bsa-notification-scheduler'
        };
        logger.debug('Posting notification schedule one-time notification request to SNS topic')
        await sns.publish(params).promise();
        
        // give the scheduler a chance to process the notification
        logger.debug('Sleeping to allow scheduler to process notification');
        await new Promise(resolve => setTimeout(resolve, 5000));

        let returnObj = await handler(event);
        expect(returnObj.totalSubmitted).to.equal(1);
        expect(returnObj.totalDeleted).to.equal(1);

        // cleanup
        await s3db.delete(`now/12345-nowNotification`);
    });

});

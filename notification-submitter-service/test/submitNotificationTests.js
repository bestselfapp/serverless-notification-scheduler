//const mochaPlugin = require('serverless-mocha-plugin');
//const expect = mochaPlugin.chai.expect;
const expect = require('chai').expect;
const logger = require('../logger');
const testHelpers = require('./testHelpers');
const { handler } = require('../index');
const AWS = require('aws-sdk');
const config = require('../config');

describe('Notification Submitter', function() {
    this.timeout(20000); // Setting global timeout to 20 seconds

    it('should process a time slot with no notifications in it without error', async function() {
        let event = require('../events/cronEventWithNoNotifications.json');
        const { notificationsSubmitted, notificationsDeleted } = await handler(event);
        expect(notificationsSubmitted).to.equal(0);
        expect(notificationsDeleted).to.equal(0);
    });

    it('should process a time slot with recurring notifications', async function() {
        let event = require('../events/cronEventWithNotifications.json');
        const { notificationsSubmitted, notificationsDeleted } = await handler(event);
        expect(notificationsSubmitted).to.be.greaterThan(0);
        expect(notificationsDeleted).to.equal(0);
    });

    it('should process a time slot with one-time notifications, deleting them afterwards', async function() {
        let event = require('../events/cronEventWithOneTimeNotifications.json');

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
                    "body": "Be careful, today you typically have events that hurt your goals!",
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
                "sendTimeUtc": "2024-01-02T03:45:00Z",
                "enableAdaptiveTiming": true,
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

        const { notificationsSubmitted, notificationsDeleted } = await handler(event);
        expect(notificationsSubmitted).to.equal(1);
        expect(notificationsDeleted).to.equal(1);
    });

});

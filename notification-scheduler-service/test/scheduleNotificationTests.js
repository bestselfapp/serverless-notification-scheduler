//const mochaPlugin = require('serverless-mocha-plugin');
//const expect = mochaPlugin.chai.expect;
const expect = require('chai').expect;
const logger = require('../logger');
const testHelpers = require('./testHelpers');
const { handler } = require('../index');

const rewire = require('rewire');
const index = rewire('../index');
const getTimeSlotFromDateStr = index.__get__('getTimeSlotFromDateStr');

describe('Notification Scheduler', function() {
    it('should process a valid brand new notification', async function() {
        let event = require('../events/validRecurringNotification.json');
        event = testHelpers.alterSnsPayload(
            event,
            { changeToNewUserId: true }
        );
        
        await handler(event);

        const { timeSlot, userId, messageId } = testHelpers.getKeyPropertiesFromSnsPayload(event);
        const notificationObj = await testHelpers.readNotificationFromS3(timeSlot, userId, messageId);
        expect(notificationObj).to.not.be.null;
        expect(notificationObj.uniqueProperties.userId).to.equal(userId);
        expect(notificationObj.uniqueProperties.messageId).to.equal(messageId);
    });

    it('should relocate an existing notification with a new time slot', async function() {
        let event = require('../events/validRecurringNotification.json');
        const notificationMessageObj = JSON.parse(event.Records[0].Sns.Message);
        const oldSendTimeUtc = notificationMessageObj.sendTimeUtc;
        const newSendTimeUtc = '2023-12-26T02:35:00Z';
        event = testHelpers.alterSnsPayload(
            event,
            {
                changeToNewUserId: true,
                changeMessageId: null,
                changeSendTimeUtc: newSendTimeUtc
            }
        );
        
        await handler(event);

        const { timeSlot, userId, messageId } = testHelpers.getKeyPropertiesFromSnsPayload(event);
        const notificationObj = await testHelpers.readNotificationFromS3(timeSlot, userId, messageId);
        expect(notificationObj).to.not.be.null;
        expect(notificationObj.uniqueProperties.userId).to.equal(userId);
        expect(notificationObj.uniqueProperties.messageId).to.equal(messageId);

        // also check that the old notification is gone
        const oldTimeSlot = getTimeSlotFromDateStr(oldSendTimeUtc);
        const oldNotificationObj = await testHelpers.readNotificationFromS3(oldTimeSlot, userId, messageId);
        expect(oldNotificationObj).to.be.null;
    });
});

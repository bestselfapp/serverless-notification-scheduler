//const mochaPlugin = require('serverless-mocha-plugin');
//const expect = mochaPlugin.chai.expect;
const expect = require('chai').expect;
const logger = require('../logger');
const testHelpers = require('./testHelpers');
const { handler } = require('../index');

describe('Notification Scheduler', function() {
    it('should process a valid brand new notification', async function() {
        let event = require('../events/validRecurringNotification.json');
        event = testHelpers.alterSnsPayload(
            event,
            { changeToNewUserId: true, changeMessageId: null }
        );
        
        await handler(event);

        const { timeSlot, userId, messageId } = testHelpers.getKeyPropertiesFromSnsPayload(event);
        //logger.debug(`timeSlot=${timeSlot}, userId=${userId}, messageId=${messageId}`)
        const notificationObj = await testHelpers.readNotificationFromS3(timeSlot, userId, messageId);
        expect(notificationObj).to.not.be.null;
        expect(notificationObj.uniqueProperties.userId).to.equal(userId);
        expect(notificationObj.uniqueProperties.messageId).to.equal(messageId);
    });
});

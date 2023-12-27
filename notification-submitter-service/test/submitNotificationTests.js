//const mochaPlugin = require('serverless-mocha-plugin');
//const expect = mochaPlugin.chai.expect;
const expect = require('chai').expect;
const logger = require('../logger');
const testHelpers = require('./testHelpers');
const { handler } = require('../index');

describe('Notification Submitter', function() {
    it('should process a time slot with no notifications in it without error', async function() {
        let event = require('../events/cronEventWithNoNotifications.json');
        const notificationsSubmitted = await handler(event);
        expect(notificationsSubmitted).to.equal(0);
    });

    it('should process a time slot with recurring notifications', async function() {
        let event = require('../events/cronEventWithNotifications.json');
        const notificationsSubmitted = await handler(event);
        expect(notificationsSubmitted).to.be.greaterThan(0);
    });
});

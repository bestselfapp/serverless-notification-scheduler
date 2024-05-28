//const mochaPlugin = require('serverless-mocha-plugin');
//const expect = mochaPlugin.chai.expect;
const expect = require('chai').expect;
const testHelpers = require('./testHelpers');
const config = require('../config');
const { handler } = require('../index');
const rewire = require('rewire');
const index = rewire('../index');
const S3DB = require('@dwkerwin/s3db');
const s3db = new S3DB('bsa-email-contents-dev-us-east-1');
const createLogger = require('../logger');
let logger = createLogger();

describe('Notification Processor', function() {
    it('should process valid email requests', async function() {
        // Upload a small HTML email to S3
        const htmlContent = "Hello <b>World</b>";
        const key = 'emails/tests/test12345/index.html';
        await s3db.putBlob(key, htmlContent);

        let event = require('../events/validEmailNotification.json');
        event.uniqueProperties.userId = testHelpers.generateNewUniqueUserId();
        if (config.EMAIL_TEST_TO_EMAIL) {
            // update env-secrets.env with this envvar to use your own email for testing
            // otherwise it'll just use whatever's in the test json event
            event.emailNotificationSettings.toEmailAddress = config.EMAIL_TEST_TO_EMAIL;
        }

        const snsPayload = testHelpers.wrapEventBodyInSnsPayload(event);

        let errorOccurred = false;
        try {
            await handler(snsPayload);
        } catch (error) {
            errorOccurred = true;
        }

        expect(errorOccurred).to.be.false;

        // Cleanup: delete the uploaded HTML file
        await s3db.delete(key);
    });
});

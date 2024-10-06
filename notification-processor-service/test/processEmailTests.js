//const mochaPlugin = require('serverless-mocha-plugin');
//const expect = mochaPlugin.chai.expect;
const expect = require('chai').expect;
const testHelpers = require('./testHelpers');
const config = require('../config');
const { handler } = require('../index');
const rewire = require('rewire');
const S3DB = require('@dwkerwin/s3db');
const s3db = new S3DB(config.EMAIL_CONTENTS_BUCKET);
const createLogger = require('../logger');
let logger = createLogger();

describe('Notification Processor', function() {
    this.timeout(15000); // Setting global timeout to 15 seconds

    it('should process a valid email request without attachments', async function() {
        // Upload a small HTML email to S3
        const htmlContent = "Hello <b>World</b>, no attachments here.";
        const s3path = 'emails/tests/testnoattach12345/';
        const key = s3path + 'index.html';
        await s3db.putBlob(key, htmlContent);

        let event = require('../events/validEmailNotification.json');
        event.uniqueProperties.userId = testHelpers.generateNewUniqueUserId();
        event.message.body = `s3://${config.EMAIL_CONTENTS_BUCKET}/${s3path}`;
        if (config.EMAIL_TEST_TO_EMAIL) {
            // update env-secrets.env with this envvar to use your own email for testing
            // otherwise it'll just use whatever's in the test json event
            event.emailNotificationSettings.toEmailAddress = config.EMAIL_TEST_TO_EMAIL;
        }

        // add the current date to the title to make it unique
        event.message.title += ' ' + new Date().toISOString();

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

    it('should process valid email requests with an attached graphic', async function() {
        // Upload an HTML email with a graphic to S3
        const htmlContent = `
            <html>
                <body>
                    Hello <b>World</b>, test graphic embedded inline.
                    <img src="cid:testimage.jpg" alt="My Test Image">
                </body>
            </html>
        `;
        const s3path = 'emails/tests/testembedded12345/'
        const key = s3path + 'index.html';
        await s3db.putBlob(key, htmlContent);

        // Upload a graphic to S3
        const graphicContent = await testHelpers.downloadTestImage();
        const graphicKey = 'emails/tests/testembedded12345/testimage.jpg';
        await s3db.putBlob(graphicKey, graphicContent);

        let event = require('../events/validEmailNotification.json');
        event.uniqueProperties.userId = testHelpers.generateNewUniqueUserId();
        event.message.body = `s3://${config.EMAIL_CONTENTS_BUCKET}/${s3path}`;
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

    it('should process valid email requests with an attached file instead of an embedded image', async function() {
        // Upload an HTML email with a graphic to S3
        const htmlContent = `
            <html>
                <body>
                    Hello <b>World, image attached here rather than embedded</b>
                </body>
            </html>
        `;
        const s3path = 'emails/tests/testattached12345/'
        const key = s3path + 'index.html';
        await s3db.putBlob(key, htmlContent);

        // Upload a graphic to S3
        const graphicContent = await testHelpers.downloadTestImage();
        const graphicKey = 'emails/tests/testattached12345/testimage.jpg';
        await s3db.putBlob(graphicKey, graphicContent);

        let event = require('../events/validEmailNotification.json');
        event.uniqueProperties.userId = testHelpers.generateNewUniqueUserId();
        event.message.body = `s3://${config.EMAIL_CONTENTS_BUCKET}/${s3path}`;
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

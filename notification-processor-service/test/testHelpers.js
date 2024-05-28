const config = require('../config');
const crypto = require('crypto');
const S3DB = require('@dwkerwin/s3db');
const Jimp = require('jimp');
const createLogger = require('../logger');
let logger = createLogger();

module.exports.wrapEventBodyInSnsPayload = function(eventBody) {
    return {
        "Records": [
            {
                "EventSource": "aws:sns",
                "EventVersion": "1.0",
                "EventSubscriptionArn": "arn:aws:sns:us-west-2:123456789012:MyTopic:12345678-1234-1234-1234-123456789012",
                "Sns": {
                    "Type": "Notification",
                    "MessageId": "12345678-1234-1234-1234-123456789012",
                    "TopicArn": "arn:aws:sns:us-west-2:123456789012:MyTopic",
                    "Subject": "BestSelfApp",
                    "Message": JSON.stringify(eventBody),
                    "Timestamp": new Date().toISOString(),
                    "SignatureVersion": "1",
                    "Signature": "EXAMPLE",
                    "SigningCertUrl": "EXAMPLE",
                    "UnsubscribeUrl": "EXAMPLE",
                    "MessageAttributes": {
                        "Test": {
                            "Type": "String",
                            "Value": "TestString"
                        },
                        "TestBinary": {
                            "Type": "Binary",
                            "Value": "TestBinary"
                        }
                    }
                }
            }
        ]
    };
}

module.exports.generateNewUniqueUserId = function () {
    return 'TEST' + crypto.randomBytes(12).toString('hex');
}

module.exports.downloadImage = async function(url) {
    const image = await Jimp.read(url);
    const buffer = await image.getBufferAsync(Jimp.AUTO);
    return buffer;
}

// Downloads a test image. Tries URLs in order until successful.
// Returns image data as a Buffer. Throws error if all URLs fail.
module.exports.downloadTestImage = async function() {
    const urls = [
        'https://placekitten.com/200/300',
        'https://picsum.photos/id/237/200/300',
        'https://via.placeholder.com/150',
        'https://source.unsplash.com/WLUHO9A_xik/1600x900'
        // Add more URLs here
    ];

    for (const url of urls) {
        try {
            const buffer = await this.downloadImage(url);
            return buffer;
        } catch (error) {
            console.error(`Failed to download image from ${url}: ${error}`);
            // If there's an error, continue to the next URL
        }
    }

    throw new Error('Failed to download image from any URL');
}

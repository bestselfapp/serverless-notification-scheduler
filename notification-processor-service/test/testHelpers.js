const config = require('../config');
const crypto = require('crypto');
const S3DB = require('@dwkerwin/s3db');
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

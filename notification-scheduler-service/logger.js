const bunyan = require('bunyan');
const PrettyStream = require('bunyan-prettystream');
const prettyStdOut = new PrettyStream();
const config = require("./config");

let stream = process.stdout
// only when running in development, pretty up the output
if (process.stdout.isTTY) {
    stream = prettyStdOut
    prettyStdOut.pipe(process.stdout);
}

module.exports = function(correlationId) {
    const baseLogger = bunyan.createLogger({
        name: 'notification-scheduler',
        streams: [
            {
                level: config.LOG_LEVEL,
                stream: stream
            }
        ]
    });

    // If correlationId is undefined, assign null to it
    if (correlationId === undefined) {
        correlationId = null;
    }

    // Create a child logger that includes the correlation ID in its fields
    return baseLogger.child({correlationId: correlationId});
};

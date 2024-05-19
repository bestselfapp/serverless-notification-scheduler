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

// Define a global correlation ID
global.correlationId = null;

module.exports = function(correlationId) {
    const baseLogger = bunyan.createLogger({
        name: 'notification-processor',
        streams: [
            {
                level: config.LOG_LEVEL,
                stream: stream
            }
        ]
    });

    // If correlationId is undefined, use the global correlation ID
    if (correlationId === undefined) {
        correlationId = global.correlationId;
    } else {
        // If a correlation ID is provided, update the global correlation ID
        global.correlationId = correlationId;
    }

    // Create a child logger that includes the correlation ID in its fields
    return baseLogger.child({correlationId: correlationId});
};

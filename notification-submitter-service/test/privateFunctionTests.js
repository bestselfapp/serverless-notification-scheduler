const expect = require('chai').expect;
const logger = require('../logger');
const testHelpers = require('./testHelpers');
const { handler } = require('../index');

const rewire = require('rewire');
const index = rewire('../index');
const determineTimeSlotFromEventTime = index.__get__('determineTimeSlotFromEventTime');

describe('determineTimeSlotFromEventTime', function() {
    it('should correctly extract and round a time slot from a string with a non-standard time slot', async function() {
        let timeSlot;
        const dateStr = '2023-12-26T03:38:00Z';
        timeSlot = determineTimeSlotFromEventTime(new Date(dateStr));
        expect(timeSlot).to.equal('03-40');
    });
});

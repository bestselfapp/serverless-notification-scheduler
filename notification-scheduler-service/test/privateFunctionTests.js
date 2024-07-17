const expect = require('chai').expect;
const testHelpers = require('./testHelpers');
const { handler } = require('../index');
const createLogger = require('../logger');
let logger = createLogger();

const rewire = require('rewire');
const index = rewire('../index');
const getTimeSlotFromDateStr = index.__get__('getTimeSlotFromDateStr');

describe('getTimeSlotFromDateStr', function() {
    it('should correctly extract a time slot', async function() {
        let timeSlot;
        timeSlot = getTimeSlotFromDateStr('2019-01-01T00:00:00Z');
        expect(timeSlot).to.equal('00-00');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T00:01:00Z');
        expect(timeSlot).to.equal('00-00');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T00:04:00Z');
        expect(timeSlot).to.equal('00-00');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T00:05:00Z');
        expect(timeSlot).to.equal('00-05');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T00:06:00Z');
        expect(timeSlot).to.equal('00-05');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T00:10:00Z');
        expect(timeSlot).to.equal('00-10');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T13:55:00Z');
        expect(timeSlot).to.equal('13-55');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T13:57:00Z');
        expect(timeSlot).to.equal('13-55');
        timeSlot = getTimeSlotFromDateStr('2019-01-01T13:59:00Z');
        expect(timeSlot).to.equal('13-55');
    });
});

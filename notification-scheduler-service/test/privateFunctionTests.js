const expect = require('chai').expect;
const testHelpers = require('./testHelpers');
const { handler } = require('../index');
const createLogger = require('../logger');
let logger = createLogger();

const rewire = require('rewire');
const index = rewire('../index');
const getTimeSlotFromDateStr = index.__get__('getTimeSlotFromDateStr');

describe('getTimeSlotFromDateStr', function() {
    it('should correctly extract a time slot from ISO 8601 format', async function() {
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

    it('should correctly extract a time slot from time-only format', async function() {
        let timeSlot;
        timeSlot = getTimeSlotFromDateStr('00:00');
        expect(timeSlot).to.equal('00-00');
        timeSlot = getTimeSlotFromDateStr('00:01');
        expect(timeSlot).to.equal('00-00');
        timeSlot = getTimeSlotFromDateStr('00:04');
        expect(timeSlot).to.equal('00-00');
        timeSlot = getTimeSlotFromDateStr('00:05');
        expect(timeSlot).to.equal('00-05');
        timeSlot = getTimeSlotFromDateStr('00:06');
        expect(timeSlot).to.equal('00-05');
        timeSlot = getTimeSlotFromDateStr('00:10');
        expect(timeSlot).to.equal('00-10');
        timeSlot = getTimeSlotFromDateStr('13:55');
        expect(timeSlot).to.equal('13-55');
        timeSlot = getTimeSlotFromDateStr('13:57');
        expect(timeSlot).to.equal('13-55');
        timeSlot = getTimeSlotFromDateStr('13:59');
        expect(timeSlot).to.equal('13-55');
    });

    it('should throw an error for invalid input', async function() {
        expect(() => getTimeSlotFromDateStr('invalid')).to.throw();
        expect(() => getTimeSlotFromDateStr('25:00')).to.throw();
        expect(() => getTimeSlotFromDateStr('00:60')).to.throw();
        expect(() => getTimeSlotFromDateStr('2019-01-01')).to.throw();
    });
});

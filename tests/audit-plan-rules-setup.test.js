'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/Setup.gs', 'utf8');
const expectedHeaders = [
  'RuleID', 'AssignmentMode', 'RequiredRole', 'RequiredUserID', 'RequiredUserName',
  'LineID', 'LineName', 'StationID', 'StationName',
  'Frequency', 'DayOfWeek', 'DayOfMonth', 'DueTime', 'ActiveStatus',
  'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
];

let createdSheet = null;
const spreadsheet = {
  getSheetByName: name => createdSheet && createdSheet.name === name ? createdSheet : null,
  insertSheet: name => {
    createdSheet = {
      name,
      frozenRows: 0,
      values: [],
      getRange: () => ({
        setValues(values) {
          createdSheet.values = values;
          return this;
        }
      }),
      setFrozenRows(rows) {
        createdSheet.frozenRows = rows;
      }
    };
    return createdSheet;
  }
};

const context = {
  SHEET_NAMES: { AUDIT_PLAN_RULES: 'AuditPlanRules' },
  SHEET_HEADERS: {},
  getSpreadsheet_: () => spreadsheet,
  getHeaders_: sheet => sheet.values[0] || [],
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => '1',
      setProperty: () => {}
    })
  }
};
vm.createContext(context);
vm.runInContext(source, context);

const results = context.setupHeaders();
assert(createdSheet, 'setupHeaders should create the missing AuditPlanRules sheet');
assert.strictEqual(createdSheet.name, 'AuditPlanRules');
assert.deepStrictEqual(Array.from(createdSheet.values[0]), expectedHeaders);
assert.strictEqual(createdSheet.frozenRows, 1);
assert.deepStrictEqual(Array.from(results), ['AuditPlanRules: created']);

createdSheet.values.push(['RULE-0001', 'Leader']);
const existingData = JSON.stringify(createdSheet.values);
const secondResults = context.setupHeaders();
assert.strictEqual(JSON.stringify(createdSheet.values), existingData, 'setupHeaders must not clear existing rule data');
assert.deepStrictEqual(Array.from(secondResults), ['AuditPlanRules: unchanged']);

console.log('AuditPlanRules setup test passed.');

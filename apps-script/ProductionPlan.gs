/** Daily production line check-in — per user per shift per date. */
var PROD_PLAN_PREFIX = 'PP_';

function getProductionPlan(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var shiftName = cleanString_(payload.shiftName) || '';
    var shiftDate = cleanString_(payload.shiftDate) || formatDateBangkok_(new Date());
    var key = buildPlanKey_(currentUser.UserID, shiftDate, shiftName);
    var stored = PropertiesService.getScriptProperties().getProperty(key);
    var activeLineIds = stored ? JSON.parse(stored) : null;
    return jsonResponse(true, 'Production plan loaded.', {
      date: shiftDate, shiftName: shiftName,
      activeLineIds: activeLineIds, isSet: activeLineIds !== null
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function saveProductionPlan(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var shiftName = cleanString_(payload.shiftName) || 'กะเช้า';
    var shiftDate = cleanString_(payload.shiftDate) || formatDateBangkok_(new Date());
    var key = buildPlanKey_(currentUser.UserID, shiftDate, shiftName);
    var lineIds = Array.isArray(payload.lineIds)
      ? payload.lineIds.map(cleanString_).filter(Boolean) : [];
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(lineIds));
    cleanOldProductionPlans_();
    return jsonResponse(true, 'Production plan saved.', {
      date: shiftDate, shiftName: shiftName, activeLineIds: lineIds
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function buildPlanKey_(userId, shiftDate, shiftName) {
  var dateStr = cleanString_(shiftDate).replace(/-/g, '');
  var shift = cleanString_(shiftName).replace(/\s/g, '_') || 'any';
  return PROD_PLAN_PREFIX + cleanString_(userId) + '_' + dateStr + '_' + shift;
}

function cleanOldProductionPlans_() {
  try {
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 3);
    var cutoffDate = formatDateBangkok_(cutoff).replace(/-/g, '');
    var props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).forEach(function (k) {
      if (!k.startsWith(PROD_PLAN_PREFIX)) return;
      // key format: PP_{userId}_{YYYYMMDD}_{shift}
      var parts = k.split('_');
      if (parts.length >= 3) {
        var dateStr = parts[2]; // YYYYMMDD
        if (dateStr < cutoffDate) PropertiesService.getScriptProperties().deleteProperty(k);
      }
    });
  } catch (_) {}
}

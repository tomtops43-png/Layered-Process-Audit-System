/** Daily production line check-in — stores which Lines are running today. */
var PROD_PLAN_PREFIX = 'PROD_PLAN_';

function getProductionPlan(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var date = formatDateBangkok_(new Date());
    var key = PROD_PLAN_PREFIX + date.replace(/-/g, '');
    var stored = PropertiesService.getScriptProperties().getProperty(key);
    var activeLineIds = stored ? JSON.parse(stored) : null;
    return jsonResponse(true, 'Production plan loaded.', {
      date: date, activeLineIds: activeLineIds, isSet: activeLineIds !== null
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function saveProductionPlan(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var date = formatDateBangkok_(new Date());
    var key = PROD_PLAN_PREFIX + date.replace(/-/g, '');
    var lineIds = Array.isArray(payload.lineIds)
      ? payload.lineIds.map(cleanString_).filter(Boolean) : [];
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(lineIds));
    cleanOldProductionPlans_();
    return jsonResponse(true, 'Production plan saved.', { date: date, activeLineIds: lineIds });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function cleanOldProductionPlans_() {
  try {
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    var cutoffKey = PROD_PLAN_PREFIX + formatDateBangkok_(cutoff).replace(/-/g, '');
    var props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).forEach(function (k) {
      if (k.startsWith(PROD_PLAN_PREFIX) && k < cutoffKey) {
        PropertiesService.getScriptProperties().deleteProperty(k);
      }
    });
  } catch (_) {}
}

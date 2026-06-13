/** User-facing account APIs. */
function getCurrentUser(currentUser) {
  try {
    var user = findById_(SHEET_NAMES.USERS, 'UserID', currentUser.UserID);
    if (!user || !isActive_(user.ActiveStatus)) return jsonResponse(false, 'User account is unavailable.', {});
    return jsonResponse(true, 'Current user loaded.', publicUser_(user));
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

/**
 * Morning-meeting board API — posts Leaders create ahead of the pre-shift
 * meeting (problems, announcements, safety/quality notices). Complements the
 * Finding shift digest: Findings come from LPA audits, these posts don't.
 */
var MEETING_POST_STATUSES_ = ['Open', 'Discussed', 'Closed'];
var MEETING_CARRY_OVER_DAYS_ = 7;

/** Self-healing sheet creation so no manual setup run is required after deploy. */
function ensureMeetingPostsSheet_() {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(SHEET_NAMES.MEETING_POSTS);
  if (sheet) return sheet;
  sheet = spreadsheet.insertSheet(SHEET_NAMES.MEETING_POSTS);
  var headers = SHEET_HEADERS[SHEET_NAMES.MEETING_POSTS];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

/** Factory-wide (ALL) posts are visible to everyone; line posts follow Line Access. */
function canSeeMeetingPost_(user, row) {
  var lineId = cleanString_(row.LineID);
  if (isAllFilter_(lineId)) return true;
  return canAccessLine_(user, lineId, 'view');
}

function canEditMeetingPost_(user, row) {
  if (hasPermission_(user, 'meeting.manage')) return true;
  return hasPermission_(user, 'meeting.update.own') && valuesEqual_(row.CreatedBy, user.UserID);
}

function getMeetingPosts(payload, user) {
  try {
    requirePermission_(user, 'meeting.view');
    ensureMeetingPostsSheet_();
    var meetingDate = dateOnly_(payload.meetingDate) || formatDateBangkok_(new Date());
    var meetingDateValue = parseDate_(meetingDate);
    if (!meetingDateValue) return jsonResponse(false, 'Invalid meetingDate: ' + meetingDate, {});
    var lineFilter = cleanString_(payload.lineId);
    var categoryFilter = cleanString_(payload.category);
    var carryOverCutoff = new Date(meetingDateValue.getTime() - MEETING_CARRY_OVER_DAYS_ * 86400000);

    var rows = getRowsAsObjects(SHEET_NAMES.MEETING_POSTS).filter(function (row) {
      return !valuesEqual_(row.Status, 'Deleted') && canSeeMeetingPost_(user, row);
    });
    if (!isAllFilter_(lineFilter)) {
      rows = rows.filter(function (row) {
        return valuesEqual_(row.LineID, lineFilter) || isAllFilter_(row.LineID);
      });
    }
    if (categoryFilter) {
      rows = rows.filter(function (row) { return valuesEqual_(row.Category, categoryFilter); });
    }

    var posts = [];
    var carryOver = [];
    rows.forEach(function (row) {
      var postDateText = dateOnly_(row.MeetingDate);
      var postDate = parseDate_(postDateText);
      if (!postDate) return;
      var closed = valuesEqual_(row.Status, 'Closed');
      var pinnedActive = isAllowed_(row.Pinned) && !closed;
      if (postDateText === meetingDate || (pinnedActive && postDate < meetingDateValue)) {
        // Pinned posts keep showing on the board every day until closed.
        posts.push(row);
      } else if (postDate < meetingDateValue && postDate >= carryOverCutoff && !closed) {
        // Unfinished topics from the last few days carry over automatically.
        carryOver.push(row);
      }
    });

    var decorate = function (row) {
      var copy = sanitizeForClient_(row);
      copy.CanEdit = canEditMeetingPost_(user, row);
      return copy;
    };
    posts.sort(meetingPostCompare_);
    carryOver.sort(meetingPostCompare_);
    return jsonResponse(true, 'Meeting posts loaded.', {
      meetingDate: meetingDate,
      posts: posts.map(decorate),
      carryOver: carryOver.map(decorate),
      canCreate: hasPermission_(user, 'meeting.create'),
      canManage: hasPermission_(user, 'meeting.manage')
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function meetingPriorityRank_(priority) {
  var value = cleanString_(priority);
  if (value === 'ด่วน' || valuesEqual_(value, 'urgent')) return 0;
  if (value === 'สำคัญ' || valuesEqual_(value, 'important')) return 1;
  return 2;
}

function meetingPostCompare_(a, b) {
  var pinnedDiff = (isAllowed_(b.Pinned) ? 1 : 0) - (isAllowed_(a.Pinned) ? 1 : 0);
  if (pinnedDiff) return pinnedDiff;
  var priorityDiff = meetingPriorityRank_(a.Priority) - meetingPriorityRank_(b.Priority);
  if (priorityDiff) return priorityDiff;
  return cleanString_(a.CreatedAt).localeCompare(cleanString_(b.CreatedAt));
}

function resolveMeetingLineName_(lineId, providedName) {
  if (isAllFilter_(lineId)) return 'ทุกไลน์';
  var provided = cleanString_(providedName);
  if (provided) return provided;
  var line = findById_(SHEET_NAMES.LINES, 'LineID', lineId);
  return line ? cleanString_(line.LineName) : cleanString_(lineId);
}

function saveMeetingPost(payload, user) {
  try {
    ensureMeetingPostsSheet_();
    var timestamp = formatDateTimeBangkok(new Date());
    var postId = cleanString_(payload.postId);

    if (postId) {
      var existing = findById_(SHEET_NAMES.MEETING_POSTS, 'PostID', postId);
      if (!existing || valuesEqual_(existing.Status, 'Deleted')) return jsonResponse(false, 'Meeting post not found: ' + postId, {});
      if (!canEditMeetingPost_(user, existing)) return jsonResponse(false, 'You do not have permission to edit this post.', {});
      var updates = { UpdatedAt: timestamp, UpdatedBy: user.UserID };
      if (payload.meetingDate !== undefined) updates.MeetingDate = dateOnly_(payload.meetingDate);
      if (payload.shift !== undefined) updates.Shift = cleanString_(payload.shift);
      if (payload.lineId !== undefined) {
        var newLineId = cleanString_(payload.lineId);
        if (!isAllFilter_(newLineId)) requireLineAccess_(user, newLineId, 'view');
        updates.LineID = isAllFilter_(newLineId) ? 'ALL' : newLineId;
        updates.LineName = resolveMeetingLineName_(newLineId, payload.lineName);
      }
      if (payload.category !== undefined) updates.Category = cleanString_(payload.category);
      if (payload.priority !== undefined) updates.Priority = cleanString_(payload.priority) || 'ปกติ';
      if (payload.topic !== undefined) {
        updates.Topic = cleanString_(payload.topic);
        if (!updates.Topic) return jsonResponse(false, 'Topic is required.', {});
      }
      if (payload.detail !== undefined) updates.Detail = cleanString_(payload.detail);
      if (payload.photoUrl !== undefined) updates.PhotoURL = cleanString_(payload.photoUrl);
      if (payload.pinned !== undefined && hasPermission_(user, 'meeting.manage')) {
        updates.Pinned = payload.pinned ? 'Yes' : 'No';
      }
      var updated = updateObjectById(SHEET_NAMES.MEETING_POSTS, 'PostID', postId, updates);
      return jsonResponse(true, 'Meeting post updated.', { post: sanitizeForClient_(updated) });
    }

    requirePermission_(user, 'meeting.create');
    requireFields_(payload, ['topic', 'category']);
    var meetingDate = dateOnly_(payload.meetingDate) || formatDateBangkok_(new Date());
    if (!parseDate_(meetingDate)) return jsonResponse(false, 'Invalid meetingDate: ' + meetingDate, {});
    var lineId = cleanString_(payload.lineId);
    if (!isAllFilter_(lineId)) requireLineAccess_(user, lineId, 'view');
    var newPostId = generateId('MTG', SHEET_NAMES.MEETING_POSTS, 'PostID', getPeriodMonth(new Date()));
    var post = {
      PostID: newPostId, MeetingDate: meetingDate, Shift: cleanString_(payload.shift),
      LineID: isAllFilter_(lineId) ? 'ALL' : lineId,
      LineName: resolveMeetingLineName_(lineId, payload.lineName),
      Category: cleanString_(payload.category), Priority: cleanString_(payload.priority) || 'ปกติ',
      Topic: cleanString_(payload.topic), Detail: cleanString_(payload.detail),
      PhotoURL: cleanString_(payload.photoUrl),
      Status: 'Open',
      Pinned: payload.pinned && hasPermission_(user, 'meeting.manage') ? 'Yes' : 'No',
      DiscussedAt: '', DiscussedBy: '',
      CreatedAt: timestamp, CreatedBy: user.UserID,
      CreatedByName: user.FullName || user.Username || user.UserID,
      UpdatedAt: timestamp, UpdatedBy: user.UserID
    };
    appendObject(SHEET_NAMES.MEETING_POSTS, post);
    return jsonResponse(true, 'Meeting post created.', { post: post });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

/** Soft delete so the board keeps an audit trail in the sheet. */
function deleteMeetingPost(payload, user) {
  try {
    requireFields_(payload, ['postId']);
    var postId = cleanString_(payload.postId);
    var existing = findById_(SHEET_NAMES.MEETING_POSTS, 'PostID', postId);
    if (!existing || valuesEqual_(existing.Status, 'Deleted')) return jsonResponse(false, 'Meeting post not found: ' + postId, {});
    if (!canEditMeetingPost_(user, existing)) return jsonResponse(false, 'You do not have permission to delete this post.', {});
    updateObjectById(SHEET_NAMES.MEETING_POSTS, 'PostID', postId, {
      Status: 'Deleted', UpdatedAt: formatDateTimeBangkok(new Date()), UpdatedBy: user.UserID
    });
    return jsonResponse(true, 'Meeting post deleted.', { postId: postId });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

/** Tick posts through Open → Discussed → Closed during the meeting.
 * Any user who can post (meeting.create) may tick, so whoever runs the
 * meeting can mark topics discussed without owning every post. */
function updateMeetingPostStatus(payload, user) {
  try {
    requireFields_(payload, ['postId', 'status']);
    var status = cleanString_(payload.status);
    if (MEETING_POST_STATUSES_.indexOf(status) === -1) return jsonResponse(false, 'Invalid status: ' + status, {});
    var postId = cleanString_(payload.postId);
    var existing = findById_(SHEET_NAMES.MEETING_POSTS, 'PostID', postId);
    if (!existing || valuesEqual_(existing.Status, 'Deleted')) return jsonResponse(false, 'Meeting post not found: ' + postId, {});
    if (!hasPermission_(user, 'meeting.create') && !canEditMeetingPost_(user, existing)) {
      return jsonResponse(false, 'You do not have permission to update this post.', {});
    }
    var timestamp = formatDateTimeBangkok(new Date());
    var updates = { Status: status, UpdatedAt: timestamp, UpdatedBy: user.UserID };
    if (status === 'Open') {
      updates.DiscussedAt = '';
      updates.DiscussedBy = '';
    } else if (!cleanString_(existing.DiscussedAt)) {
      updates.DiscussedAt = timestamp;
      updates.DiscussedBy = user.FullName || user.Username || user.UserID;
    }
    var updated = updateObjectById(SHEET_NAMES.MEETING_POSTS, 'PostID', postId, updates);
    return jsonResponse(true, 'Meeting post status updated.', { post: sanitizeForClient_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

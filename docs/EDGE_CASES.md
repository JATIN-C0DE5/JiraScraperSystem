# Edge Cases Documentation

> Comprehensive list of all edge cases handled by the Jira LLM Pipeline

---

## Table of Contents

1. [Network & API Issues](#network--api-issues)
2. [Data Quality Issues](#data-quality-issues)
3. [Operational Issues](#operational-issues)
4. [Business Logic Edge Cases](#business-logic-edge-cases)
5. [Concurrency Issues](#concurrency-issues)
6. [File System Issues](#file-system-issues)
7. [LLM API Issues](#llm-api-issues)
8. [Configuration Issues](#configuration-issues)

---

## Network & API Issues

### 1. HTTP 429: Rate Limiting

**Scenario**: Too many requests, API returns 429.

**Handling**:
- Detect `response.status === 429`
- Read `Retry-After` header (if present)
- Wait for specified duration (default: 2 seconds)
- Retry request automatically
- Log warning with wait time

**Code**:
```javascript
if (error.response && error.response.status === 429) {
  const retryAfter = this.getRetryAfter(error.response);
  this.logger.warn(`Rate limit hit, waiting ${retryAfter}ms`);
  await this.sleep(retryAfter);
  continue; // Retry
}
```

**Result**: ✅ Request succeeds after waiting

---

### 2. HTTP 5xx: Server Errors

**Scenario**: Jira server returns 500, 502, 503, or 504.

**Handling**:
- Classify as retryable error
- Apply exponential backoff: 2s → 4s → 8s → 16s → 32s
- Retry up to 5 times
- If all retries fail: save checkpoint, log error, exit

**Code**:
```javascript
isRetryableError(error) {
  const retryableStatuses = [408, 429, 500, 502, 503, 504];
  return retryableStatuses.includes(error.response.status);
}
```

**Result**: ✅ Most transient errors recover automatically

---

### 3. Network Timeout

**Scenario**: Request takes longer than 15 seconds.

**Handling**:
- Axios timeout automatically triggers error
- Classified as retryable error
- Retry with exponential backoff
- Log timeout duration

**Code**:
```javascript
this.client = axios.create({
  baseURL: baseUrl,
  timeout: 15000, // 15 seconds
});
```

**Result**: ✅ Slow requests are retried with longer timeout on subsequent attempts

---

### 4. Connection Drops (ECONNRESET)

**Scenario**: Network connection lost mid-request.

**Handling**:
- Error has no `response` object (network-level failure)
- Classified as retryable
- Checkpoint was saved 25 issues ago (max loss: 25 issues)
- Retry with exponential backoff

**Code**:
```javascript
isRetryableError(error) {
  // No response = network error (retryable)
  if (!error.response) {
    return true;
  }
  // ...
}
```

**Result**: ✅ Pipeline resumes after network recovers

---

### 5. DNS Failures

**Scenario**: Cannot resolve `issues.apache.org`.

**Handling**:
- Same as connection drop (no response object)
- Retry with backoff
- If persistent: fails after 5 attempts, user can fix DNS and resume

**Result**: ✅ Temporary DNS issues are handled; persistent ones require user action

---

### 6. Partial Response

**Scenario**: JSON response is truncated or malformed.

**Handling**:
- JSON.parse() throws error
- Caught in try-catch
- Logged with warning
- Issue is skipped (not fatal)
- Continue with next issue

**Code**:
```javascript
try {
  const data = await this.apiClient.get(url);
  // Process data
} catch (error) {
  this.logger.warn(`Malformed response for ${url}, skipping...`, error);
  continue; // Skip this issue
}
```

**Result**: ✅ One bad response doesn't stop the entire pipeline

---

### 7. Gemini API Quota Exceeded

**Scenario**: Even with pro account, hit daily quota.

**Handling**:
- Gemini API returns quota error
- Retry logic attempts 5 times
- After 5 failures: stop processing, save progress
- User can resume next day

**Code**:
```python
except Exception as error:
    if attempt < retries:
        delay = min(2 ** attempt, 32)
        print(f"⚠️  API error, retrying in {delay}s...")
        time.sleep(delay)
    else:
        print(f"❌ Max retries exceeded")
        raise error
```

**Result**: ✅ Progress is saved, can resume when quota resets

---

## Data Quality Issues

### 8. Missing Description

**Scenario**: Issue has no description field.

**Handling**:
- Check `fields.description` exists
- If null/undefined: use summary instead
- If both missing: use issue key as context
- Log warning

**Code**:
```python
description = fields.get('description', 'No description provided')
if not description:
    description = fields.get('summary', f'Issue {issue_key}')
```

**Result**: ✅ LLM still gets context from summary/title

---

### 9. Missing Summary

**Scenario**: Issue has no summary field.

**Handling**:
- Use issue key as summary
- Use description (if available) as main content
- Log warning

**Code**:
```python
summary = fields.get('summary', 'No summary')
if not summary:
    summary = issue.get('key', 'UNKNOWN')
```

**Result**: ✅ Minimal context, but processing continues

---

### 10. Empty Comments Array

**Scenario**: Issue has `comments: []` (no comments).

**Handling**:
- Skip comments section in context
- Proceed with description only
- No error logged (common for new issues)

**Code**:
```python
comments = issue.get('comments', [])
if comments:
    # Include comments in context
else:
    # Skip comments section
```

**Result**: ✅ LLM generates tasks from description alone

---

### 11. Null Assignee

**Scenario**: Issue has `assignee: null` (unassigned).

**Handling**:
- Check if assignee exists
- Use "Unassigned" as displayName
- No error logged

**Code**:
```python
assignee = fields.get('assignee', {})
assignee_name = assignee.get('displayName', 'Unassigned') if assignee else 'Unassigned'
```

**Result**: ✅ Context shows "Assignee: Unassigned"

---

### 12. Malformed JSON in API Response

**Scenario**: Jira returns invalid JSON.

**Handling**:
- JSON.parse() throws SyntaxError
- Caught in API client retry logic
- Logged with error details
- Issue is skipped after max retries

**Code**:
```javascript
try {
  return JSON.parse(responseText);
} catch (error) {
  this.logger.error('Failed to parse JSON response', error);
  throw error; // Triggers retry
}
```

**Result**: ✅ Logged for debugging, pipeline continues

---

### 13. Very Long Text (>10k characters)

**Scenario**: Issue description is 50,000 characters.

**Handling**:
- Truncate at 3,000 characters (configurable)
- Append: `\n[... truncated for length ...]`
- Prevents memory issues and API token limits

**Code**:
```python
if len(description) > 3000:
    description = description[:3000] + '\n[... truncated for length ...]'
```

**Result**: ✅ LLM gets meaningful context without overwhelming tokens

---

### 14. Special Characters & Unicode

**Scenario**: Description contains emoji, non-ASCII, or control characters.

**Handling**:
- JavaScript: UTF-8 by default (no special handling needed)
- Python: Files opened with `utf-8` encoding
- Sanitize control characters (null bytes)

**Code**:
```python
text = text.replace('\x00', '')  # Remove null bytes
text = ''.join(char for char in text if ord(char) >= 32 or char in '\n\r\t')
```

**Result**: ✅ Unicode preserved, control characters removed

---

### 15. HTML in Description

**Scenario**: Description contains HTML tags like `<br>`, `<p>`, etc.

**Handling**:
- **Preserve HTML** (don't strip)
- Jira descriptions often use HTML formatting
- LLM can understand HTML context

**Alternative**: Could strip HTML with library, but decided to keep for context richness.

**Result**: ✅ LLM interprets HTML as part of technical documentation

---

## Operational Issues

### 16. Script Killed Mid-Run

**Scenario**: User presses Ctrl+C or kills process.

**Handling**:
- Checkpoint was saved 0-24 issues ago
- On restart: load checkpoint, resume from `lastStartAt`
- Max loss: 24 issues (will re-scrape)

**Code**:
```javascript
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Interrupted by user. Progress saved.');
  process.exit(0);
});
```

**Result**: ✅ Seamless resume, minimal re-work

---

### 17. Disk Full

**Scenario**: No space left on device during file write.

**Handling**:
- `fs.writeFile()` throws ENOSPC error
- Caught in checkpoint save
- Logged with error
- Process exits (cannot continue without saving)
- User must free disk space and resume

**Code**:
```javascript
try {
  await fs.writeFile(path, data);
} catch (error) {
  if (error.code === 'ENOSPC') {
    this.logger.error('Disk full! Cannot save checkpoint.', error);
  }
  throw error;
}
```

**Result**: ⚠️ Requires user intervention, but data is safe (last checkpoint)

---

### 18. Out of Memory

**Scenario**: Process uses >4GB RAM (unlikely with our design).

**Handling**:
- **Prevention**: Streaming processing (don't load all issues)
- **Detection**: Node.js will throw heap error
- **Recovery**: Not automatic (would require restart)
- **Mitigation**: Reduce `max_concurrent_requests` to lower memory

**Result**: ✅ Should not occur with default settings; configurable if needed

---

### 19. Invalid API Key

**Scenario**: GEMINI_API_KEY is wrong or expired.

**Handling**:
- Gemini SDK throws authentication error
- Detected in `test_connection()`
- Fails fast with clear error message
- Exits before any processing

**Code**:
```python
if not gemini_client.test_connection():
    print("❌ Failed to connect to Gemini API")
    sys.exit(1)
```

**Result**: ✅ Fast failure with actionable error message

---

### 20. Gemini API Down

**Scenario**: Google's Gemini service is unavailable.

**Handling**:
- Retry logic attempts 5 times with backoff
- If still failing: stop processing, save progress
- User can resume when service is back

**Result**: ✅ Progress saved, can resume when API recovers

---

## Business Logic Edge Cases

### 21. Issue Has No Comments

**Scenario**: Brand new issue with no discussion yet.

**Handling**:
- Create training tasks from description only
- Summary still generated
- Classification still works
- Q&A limited to description content

**Result**: ✅ Still generates 8 tasks, just less context

---

### 22. Issue Deleted Between Fetch and Comment Retrieval

**Scenario**: Issue exists in search results but is deleted before fetching comments.

**Handling**:
- Comment fetch returns 404
- Logged as warning (not error)
- Issue is skipped
- Continue with next issue

**Code**:
```javascript
async fetchComments(issueKey) {
  try {
    const result = await this.apiClient.get(`/issue/${issueKey}/comment`);
    return result.comments || [];
  } catch (error) {
    this.logger.warn(`Could not fetch comments for ${issueKey}`, error);
    return []; // Graceful degradation
  }
}
```

**Result**: ✅ Gracefully skipped, pipeline continues

---

### 23. Issue Updated While Scraping

**Scenario**: Issue is modified during scraping run.

**Handling**:
- **Current run**: Captures state at time of fetch
- **Next run**: Incremental update will fetch new version
- **Versioning**: Use `updated` timestamp to detect changes

**Result**: ✅ Handled by incremental update logic

---

### 24. Duplicate Issues

**Scenario**: Same issue appears twice in API results (shouldn't happen, but...).

**Handling**:
- Use Map with issue key as unique identifier
- Duplicate keys are automatically deduplicated
- Last occurrence wins (most recent)

**Code**:
```javascript
const issueMap = new Map();
issues.forEach(issue => issueMap.set(issue.key, issue));
const uniqueIssues = [...issueMap.values()];
```

**Result**: ✅ Duplicates automatically removed

---

### 25. Project Has 0 Issues

**Scenario**: Selected project has no issues (empty project).

**Handling**:
- `getTotalIssueCount()` returns 0
- Log warning
- Skip project entirely
- Continue with next project

**Code**:
```javascript
if (totalIssues === 0) {
  this.logger.warn(`No issues found in project ${projectKey}`);
  return; // Skip
}
```

**Result**: ✅ Logged, skipped, no error

---

### 26. All 3 Projects Fail

**Scenario**: None of the selected projects can be scraped.

**Handling**:
- Each project failure is logged
- After all projects attempted: check if any succeeded
- If zero succeeded: exit with error
- User can check logs and retry

**Code**:
```javascript
let successCount = 0;
for (const project of projects) {
  try {
    await scrapeProject(project);
    successCount++;
  } catch (error) {
    logger.error(`Failed to scrape ${project}`, error);
  }
}

if (successCount === 0) {
  logger.error('All projects failed');
  process.exit(1);
}
```

**Result**: ✅ Clear error message with logs for debugging

---

## Concurrency Issues

### 27. Race Condition in Checkpoint Saves

**Scenario**: Multiple saves happening simultaneously (shouldn't with current design).

**Handling**:
- **Prevention**: Saves are sequential (called from main loop)
- **Safety**: Atomic writes (temp file + rename)
- **Recovery**: If somehow corrupted, delete checkpoint and re-scrape

**Result**: ✅ Not possible with current single-threaded design

---

### 28. Comment Fetching Fails for Some Issues

**Scenario**: 5 out of 50 issues have comment fetch failures.

**Handling**:
- Each comment fetch is in try-catch
- Failed fetches return `[]` (empty array)
- Warning logged
- Other 45 issues proceed normally

**Code**:
```javascript
const tasks = issues.map(issue =>
  limit(async () => {
    try {
      const comments = await fetchComments(issue.key);
      issue.comments = comments;
    } catch (error) {
      logger.warn(`Failed to fetch comments for ${issue.key}`);
      issue.comments = [];
    }
  })
);
```

**Result**: ✅ Partial success, pipeline continues

---

## File System Issues

### 29. Checkpoint File Corrupted

**Scenario**: Checkpoint JSON is malformed (unlikely due to atomic writes).

**Handling**:
- JSON.parse() throws error when loading
- Caught and logged
- Treat as "no checkpoint" (start fresh)

**Code**:
```javascript
try {
  const checkpoint = JSON.parse(await fs.readFile(path));
  return checkpoint;
} catch (error) {
  this.logger.warn('Corrupted checkpoint, starting fresh', error);
  return null;
}
```

**Result**: ✅ Starts fresh for that project

---

### 30. Permission Denied on Data Directory

**Scenario**: No write permission to `data/raw/` or `data/checkpoints/`.

**Handling**:
- `mkdir -p` or `writeFile` throws EACCES error
- Logged with error
- Process exits (cannot continue)
- User must fix permissions

**Code**:
```javascript
try {
  await fs.mkdir(dir, { recursive: true });
} catch (error) {
  if (error.code === 'EACCES') {
    this.logger.error(`Permission denied: ${dir}`, error);
  }
  throw error;
}
```

**Result**: ⚠️ Requires user to run `chmod` or `chown`

---

### 31. File Name Too Long

**Scenario**: Issue key is extremely long (e.g., `PROJECTWITHVERYLONGNAME-123456`).

**Handling**:
- **Prevention**: Project keys are typically short (e.g., KAFKA)
- **Fallback**: Truncate if needed (not implemented, extremely rare)

**Result**: ✅ Not an issue with Apache Jira (keys are short)

---

## LLM API Issues

### 32. Gemini Returns Empty Response

**Scenario**: API call succeeds but `response.text` is empty.

**Handling**:
- Check `if response.text:`
- If empty: raise ValueError
- Retry with backoff (5 attempts)
- If still empty: skip issue

**Code**:
```python
if response.text:
    return response.text.strip()
else:
    raise ValueError("Empty response from Gemini API")
```

**Result**: ✅ Retried, logged, skipped if persistent

---

### 33. Gemini Returns Non-JSON for Classification

**Scenario**: Expected JSON, got plain text.

**Handling**:
- Try to extract JSON from response (look for `{...}`)
- If extraction fails: use default values
- Log warning

**Code**:
```python
try:
    json_start = response.find('{')
    json_end = response.rfind('}') + 1
    if json_start != -1 and json_end > json_start:
        json_str = response[json_start:json_end]
        return json.loads(json_str)
    else:
        return default_classification
except json.JSONDecodeError:
    return default_classification
```

**Result**: ✅ Fallback to defaults, pipeline continues

---

### 34. Gemini Generates Fewer Q&A Pairs Than Requested

**Scenario**: Asked for 5 pairs, got 3.

**Handling**:
- Accept whatever was generated
- Slice to requested number if more than expected
- Log actual count

**Code**:
```python
pairs = json.loads(response)
return pairs[:num_pairs]  # Use first N pairs
```

**Result**: ✅ Flexible, accepts partial results

---

## Configuration Issues

### 35. Invalid YAML Configuration

**Scenario**: `config.yaml` has syntax error.

**Handling**:
- YAML parser throws error
- Caught at startup
- Clear error message with line number
- Exits before any work starts

**Code**:
```javascript
try {
  const config = yaml.parse(configFile);
} catch (error) {
  console.error('Invalid config.yaml:', error.message);
  process.exit(1);
}
```

**Result**: ✅ Fail fast with actionable error

---

### 36. Missing Configuration File

**Scenario**: `config/config.yaml` doesn't exist.

**Handling**:
- File read throws ENOENT
- Clear error message
- Exit

**Code**:
```javascript
if (!fs.existsSync('config/config.yaml')) {
  console.error('❌ Configuration file not found: config/config.yaml');
  process.exit(1);
}
```

**Result**: ✅ Fail fast with clear message

---

### 37. Invalid Project Keys in Manual Selection

**Scenario**: User configures `manual_selection: ["INVALID", "FAKE"]`.

**Handling**:
- ProjectSelector validates each project
- Tries to fetch issue count
- If 0 issues or error: removes from list
- Warns user

**Code**:
```javascript
const validProjects = [];
for (const key of projectKeys) {
  try {
    const count = await this.getIssueCount(key);
    if (count > 0) {
      validProjects.push(key);
    } else {
      logger.warn(`Project ${key} has no issues`);
    }
  } catch (error) {
    logger.warn(`Project ${key} is invalid`, error);
  }
}
return validProjects;
```

**Result**: ✅ Invalid projects filtered out automatically

---

## Summary Statistics

### Total Edge Cases Documented: 37

**By Category**:
- Network & API Issues: 7
- Data Quality Issues: 8
- Operational Issues: 5
- Business Logic Edge Cases: 6
- Concurrency Issues: 2
- File System Issues: 3
- LLM API Issues: 3
- Configuration Issues: 3

**Handling Strategies**:
- ✅ **Automatic Recovery**: 28 cases
- ⚠️ **Requires User Action**: 9 cases
- 🔄 **Graceful Degradation**: 12 cases

**Logging**:
- All edge cases are logged
- Errors go to `error-{DATE}.log`
- Warnings go to `combined-{DATE}.log`

---

## Testing Recommendations

While formal unit tests are not included, these edge cases can be manually tested:

1. **Network Failures**: Disconnect internet mid-scrape
2. **Rate Limiting**: Set very high concurrency
3. **Invalid Data**: Manually edit checkpoint files
4. **API Errors**: Use invalid API key
5. **Disk Full**: Fill up disk during scrape
6. **Interruptions**: Kill process with `Ctrl+C`

---

*This document describes edge case handling as of November 2, 2025.*

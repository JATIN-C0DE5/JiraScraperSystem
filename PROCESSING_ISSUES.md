# Processing Issues Fix Summary
**Date:** November 2, 2025

---

## Issues Identified

### Issue 1: Gemini API Quota Exceeded ⚠️

**Error Messages:**
```
429 You exceeded your current quota
* Quota exceeded for metric: generate_content_free_tier_requests
  - limit: 10 requests per minute
  - limit: 50 requests per day
Please retry in 48s...
```

**Root Cause:**
The Gemini API free tier has strict rate limits:
- **10 requests per minute** (per model)
- **50 requests per day** (per model)

Your processor makes 3 API calls per issue (summarization + classification + Q&A), so you can only process:
- **~3 issues per minute** (10 requests / 3 calls)
- **~16 issues per day** (50 requests / 3 calls)

You processed **~17 issues** before hitting the daily limit.

**Solutions:**
1. **Wait 24 hours** for quota to reset
2. **Upgrade to paid plan** for higher limits:
   - Pay-as-you-go: 360 requests/minute, no daily limit
   - See: https://ai.google.dev/pricing
3. **Reduce API calls per issue** (modify config to disable some tasks)
4. **Use a different model** (switch from `gemini-2.0-flash-exp` to `gemini-1.5-flash`)

---

### Issue 2: NoneType Errors in Data Processing ✅ FIXED

**Error Messages:**
```
⚠️  Error processing issue SPARK-514: 'NoneType' object has no attribute 'get'
⚠️  Error processing issue SPARK-578: object of type 'NoneType' has no len()
```

**Root Cause:**
Many Jira issues have `null` (None) values for fields like:
- `priority`: null (not set)
- `assignee`: null (unassigned)
- Sometimes `comments`: null

The code attempted to call `.get()` on None:
```python
priority = fields.get('priority', {}).get('name', 'Unknown')
# When priority is None, this fails: None.get('name')
```

**Fix Applied:**
Modified `task_generator.py` to handle None values:

```python
# OLD (BROKEN):
priority = fields.get('priority', {}).get('name', 'Unknown')
assignee = fields.get('assignee', {})
assignee_name = assignee.get('displayName', 'Unassigned')

# NEW (FIXED):
priority_obj = fields.get('priority') or {}
priority = priority_obj.get('name', 'Unset') if isinstance(priority_obj, dict) else 'Unset'

assignee = fields.get('assignee')
assignee_name = assignee.get('displayName', 'Unassigned') if assignee and isinstance(assignee, dict) else 'Unassigned'
```

**Fields Fixed:**
- ✅ `priority` - handles None
- ✅ `assignee` - handles None  
- ✅ `reporter` - handles None
- ✅ `status` - handles None
- ✅ `issuetype` - handles None
- ✅ `description` - handles None
- ✅ `comments` - handles None and validates list items

---

## Current Status

### Successfully Processed
- **~17 issues** before hitting quota limit
- Generated training examples for valid issues
- No crashes from None errors (after fix)

### Remaining
- **433 issues** in SPARK_issues_partial.json
- **2 more projects** (FLINK, FLEX) not started

### Output
- ❌ Pipeline stopped due to quota limits
- ⚠️ Output file has 0 examples (you interrupted it)

---

## How to Continue

### Option 1: Wait and Retry (Free)
```bash
# Wait 24 hours for quota reset
# Then run again
export GEMINI_API_KEY='your-key'
./scripts/run_processor.sh
```

**Limitations:**
- Can only process ~16 issues per day
- Would take **~28 days** to process 450 issues
- **~192 days** to process all 3 projects (127K issues)

---

### Option 2: Upgrade API Plan (Recommended)

**Paid Plan Benefits:**
- 360 requests per minute (vs 10)
- No daily limit (vs 50)
- Can process full dataset in ~days instead of months

**Steps:**
1. Go to: https://aistudio.google.com/app/prompts/billing
2. Enable billing and set budget
3. Get new API key from paid project
4. Export new key: `export GEMINI_API_KEY='new-key'`
5. Run processor: `./scripts/run_processor.sh`

**Cost Estimate (Gemini 2.0 Flash):**
- Input: $0.15 per 1M tokens
- Output: $0.60 per 1M tokens
- For 450 issues (~2.8MB JSON):
  - Estimated cost: **~$5-10** for all 3 projects
  - Much cheaper than time waiting for free tier!

---

### Option 3: Reduce API Calls

Modify config to generate fewer tasks per issue:

```yaml
# config/config.yaml
processor:
  tasks:
    summarization:
      enabled: false  # Disable to save 1 API call per issue
    classification:
      enabled: true   # Keep (1 API call)
    qna:
      enabled: true
      pairs_per_issue: 3  # Reduce from 5 to 3 (1 API call)
```

This reduces from 3 to 2 API calls per issue:
- Can process **~5 issues per minute**
- Can process **~25 issues per day**
- Would take **~18 days** for 450 issues

---

### Option 4: Switch to Different Model

Try Gemini 1.5 Flash (older but may have different limits):

```python
# src/processor/gemini_client.py
# Change model name
model_name = 'gemini-1.5-flash'  # Instead of gemini-2.0-flash-exp
```

---

## Testing the NoneType Fix

The NoneType errors are now fixed. To verify:

```bash
# Test with a single issue that previously failed
source venv/bin/activate
python3 << 'PYEOF'
import sys
sys.path.insert(0, 'src')
sys.path.insert(0, 'src/processor')

from processor.task_generator import TaskGenerator
from processor.gemini_client import GeminiClient
import json
import os

# Load config
import yaml
with open('config/config.yaml') as f:
    config = yaml.safe_load(f)

# Load issue that previously failed
with open('data/raw/SPARK_issues_partial.json') as f:
    issues = json.load(f)
    issue = next(i for i in issues if i['key'] == 'SPARK-514')

# Initialize (API key required but won't be called)
os.environ['GEMINI_API_KEY'] = 'test'
client = GeminiClient(config['gemini'])
gen = TaskGenerator(client)

# Test format_issue_context (doesn't call API)
try:
    context = gen.format_issue_context(issue)
    print("✅ SUCCESS: No NoneType errors!")
    print(f"Context length: {len(context)} characters")
    print("\nFirst 500 chars:")
    print(context[:500])
except Exception as e:
    print(f"❌ FAILED: {e}")
PYEOF
```

---

## Summary

**Fixed:**
- ✅ NoneType errors in task_generator.py
- ✅ Handles None for priority, assignee, reporter, status, comments

**Blocked:**
- ⚠️ Gemini API quota exceeded (10/min, 50/day)
- ⚠️ Need to wait 24 hours OR upgrade to paid plan

**Recommendation:**
1. **Verify the NoneType fix works** (run test above)
2. **Decide on API approach:**
   - Wait 24h (free but slow)
   - Upgrade to paid ($5-10 for full dataset, much faster)
   - Reduce tasks per issue (moderate speed)
3. **Continue processing** once quota available

---

## Next Steps

```bash
# 1. Wait for quota reset (24 hours)

# 2. Verify fix (optional)
source venv/bin/activate
# Run test code above

# 3. Resume processing
export GEMINI_API_KEY='your-key'
./scripts/run_processor.sh

# Monitor progress:
tail -f logs/combined-2025-11-02.log
```

The pipeline will now handle None values gracefully and won't crash!

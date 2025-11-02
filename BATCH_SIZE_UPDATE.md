# Batch Size Configuration Update

**Date:** November 2, 2025  
**Change:** Updated scraping batch size from 50 to 5 issues

---

## What Changed

### Configuration File: `config/config.yaml`

```yaml
scraping:
  page_size: 5  # Changed from 50 to 5
```

---

## Impact

### Advantages ✅

1. **Better Progress Visibility**
   - Updates every 5 issues instead of every 50
   - Progress bar moves more frequently
   - Easier to see scraper is working

2. **More Frequent Checkpoints (Relative)**
   - Checkpoint saves every 25 issues
   - With batch 5: saves every 5 batches
   - With batch 50: saved every 0.5 batches (mid-batch)

3. **Easier Testing**
   - Quick feedback during development
   - Can interrupt and see progress sooner

### Trade-offs ⚠️

1. **More API Calls**
   - Before: 1,074 requests (53,722 ÷ 50)
   - After: 10,744 requests (53,722 ÷ 5)
   - 10x more API calls

2. **Slightly Slower**
   - More API overhead from additional requests
   - Network latency adds up
   - Estimated: ~10-15% slower overall

3. **More Rate Limit Consideration**
   - More frequent requests
   - Rate limiter still enforces 100ms delay
   - Should be fine with current limits

---

## Example Output

### Before (Batch Size 50)
```
SPARK | ░░░░░░░░░ | 0% | 0/53722 issues
SPARK | █░░░░░░░░ | 0% | 50/53722 issues
SPARK | ██░░░░░░░ | 0% | 100/53722 issues
```

### After (Batch Size 5)
```
SPARK | ░░░░░░░░░ | 0% | 0/53722 issues
SPARK | ░░░░░░░░░ | 0% | 5/53722 issues
SPARK | ░░░░░░░░░ | 0% | 10/53722 issues
SPARK | ░░░░░░░░░ | 0% | 15/53722 issues
SPARK | ░░░░░░░░░ | 0% | 20/53722 issues
SPARK | █░░░░░░░░ | 0% | 25/53722 issues  ← Checkpoint saved
```

---

## Running the Scraper

The change is automatic. Just run:

```bash
./scripts/run_scraper.sh
```

The scraper will:
1. Load existing checkpoint (450 issues)
2. Resume from position 450
3. Fetch in batches of 5 issues
4. Save checkpoint every 25 issues
5. Continue until complete or interrupted

---

## Reverting the Change

If you want to go back to 50:

```bash
# Edit config/config.yaml
sed -i 's/page_size: 5/page_size: 50/' config/config.yaml
```

Or manually edit:
```yaml
scraping:
  page_size: 50  # Back to default
```

---

## Notes

- Batch size doesn't affect checkpoint resume logic
- Existing partial files work with any batch size
- Change applies to all projects (SPARK, FLINK, FLEX)
- No need to restart from scratch

---

## Summary

✅ **Batch size reduced to 5 for better progress visibility**  
⚙️ **Trade-off: More API calls but better user experience**  
📊 **Checkpoints still save every 25 issues**  
🚀 **Ready to run with: `./scripts/run_scraper.sh`**

# System Architecture

> Detailed technical design and implementation decisions for the Jira LLM Pipeline

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Design Principles](#design-principles)
3. [Two-Layer Architecture](#two-layer-architecture)
4. [Data Flow](#data-flow)
5. [Checkpoint Strategy](#checkpoint-strategy)
6. [Concurrency Model](#concurrency-model)
7. [Rate Limiting](#rate-limiting)
8. [Error Recovery](#error-recovery)
9. [Incremental Update Logic](#incremental-update-logic)
10. [LLM Integration](#llm-integration)
11. [Scalability Analysis](#scalability-analysis)
12. [Trade-offs & Alternatives](#trade-offs--alternatives)

---

## System Overview

The Jira LLM Pipeline is designed as a **two-phase, two-language system** optimized for reliability, resumability, and scalability.

### Key Characteristics

- **Stateful**: Checkpoints preserve exact scraping state
- **Idempotent**: Re-running the same scrape produces identical results
- **Fault-Tolerant**: Handles network failures, API errors, interruptions
- **Resource-Efficient**: Streaming processing, memory-bounded
- **Observable**: Comprehensive logging and progress tracking

### High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   PHASE 1: SCRAPING                 │
│                  (JavaScript/Node.js)               │
│                                                     │
│  Input:  Jira REST API                             │
│  Output: Raw JSON files (data/raw/)                │
│  State:  Checkpoints (data/checkpoints/)           │
│                                                     │
│  Components:                                        │
│    - JiraScraper (orchestrator)                    │
│    - ApiClient (HTTP + retry)                      │
│    - CheckpointManager (state persistence)         │
│    - RateLimiter (respectful API usage)            │
│    - ProjectSelector (smart project selection)     │
│    - IncrementalUpdater (delta fetching)           │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                  PHASE 2: PROCESSING                │
│                    (Python 3.10+)                   │
│                                                     │
│  Input:  Raw JSON files (data/raw/)                │
│  Output: JSONL training files (data/final/)        │
│                                                     │
│  Components:                                        │
│    - GeminiClient (LLM API wrapper)                │
│    - TaskGenerator (training task creation)        │
│    - DataTransformer (JSONL formatting)            │
│    - Validator (quality checks)                    │
└─────────────────────────────────────────────────────┘
```

---

## Design Principles

### 1. **Separation of Concerns**

**Why Two Languages?**

- **JavaScript (Scraping)**:
  - Excellent async/await support for I/O-heavy tasks
  - Rich ecosystem for HTTP clients (axios)
  - Native JSON handling
  - Fast execution for network operations

- **Python (LLM Processing)**:
  - Official Gemini SDK (google-generativeai)
  - Superior AI/ML library ecosystem
  - Better data processing libraries (jsonlines, tqdm)
  - Easier prompt engineering and LLM integration

**Benefit**: Each phase uses the best tool for its job.

### 2. **Fail-Safe by Default**

- Checkpoints saved atomically (write to temp, then rename)
- Errors are logged, not silently ignored
- On critical failure: save state, log error, exit gracefully
- User can always resume from last good checkpoint

### 3. **Optimize for Resume, Not Just Speed**

- Checkpoints are first-class citizens
- Every 25 issues = checkpoint (tunable)
- Trade-off: Slight performance overhead for bulletproof resumability

### 4. **Streaming Over Loading**

- Don't load all 60k issues into memory
- Process in batches, stream JSONL output
- Constant memory footprint (~500MB) regardless of dataset size

### 5. **Respectful API Usage**

- Rate limiting to avoid overwhelming Jira/Gemini APIs
- Exponential backoff on errors (not aggressive retry)
- Configurable delays and concurrency limits

---

## Two-Layer Architecture

### Layer 1: JavaScript Scraper

**Responsibilities:**
1. Connect to Jira REST API
2. Discover and select high-quality projects
3. Paginate through all issues (50 per page)
4. Fetch comments for each issue (parallel)
5. Save raw JSON to disk
6. Manage checkpoints for resume capability

**Why JavaScript?**
- **Event Loop**: Perfect for thousands of concurrent HTTP requests
- **Async/Await**: Clean code for asynchronous operations
- **axios**: Best-in-class HTTP client with retry/timeout support
- **p-limit**: Elegant concurrency control
- **cli-progress**: Beautiful progress bars

**Key Classes:**

```javascript
ApiClient
  ├── Handles HTTP requests
  ├── Implements exponential backoff
  └── Detects retryable vs non-retryable errors

RateLimiter
  ├── Token bucket algorithm
  ├── Configurable delay between requests
  └── Burst handling

CheckpointManager
  ├── Load/save checkpoint JSON files
  ├── Atomic writes (crash-safe)
  └── Project-specific state tracking

JiraScraper
  ├── Orchestrates entire scraping process
  ├── Manages progress bars
  └── Coordinates all components
```

### Layer 2: Python Processor

**Responsibilities:**
1. Load scraped JSON files
2. Format issues into readable context
3. Generate training tasks via Gemini API
4. Validate and transform to JSONL
5. Create statistics and quality reports

**Why Python?**
- **Gemini SDK**: Official Google library with best support
- **Type Hints**: Better code clarity and IDE support
- **jsonlines**: Native JSONL support
- **tqdm**: Progress bars with ETA
- **Data Science Ecosystem**: Easy to extend with pandas, numpy, etc.

**Key Classes:**

```python
GeminiClient
  ├── Wraps google-generativeai SDK
  ├── Implements retry logic
  └── Handles API errors gracefully

TaskGenerator
  ├── Formats issue context for LLM
  ├── Generates 3 task types (summary, classification, Q&A)
  └── Tracks statistics

DataTransformer
  ├── Writes JSONL files (streaming)
  ├── Merges multiple project files
  └── Generates statistics reports
```

---

## Data Flow

### Detailed Flow Diagram

```
1. User runs: ./scripts/run_pipeline.sh

2. SCRAPING PHASE
   ├── ProjectSelector.selectProjects()
   │   ├── Fetch all Apache projects from Jira
   │   ├── Filter by min_issues (10,000+)
   │   ├── Score by: issue count + recent activity + preferred list
   │   └── Return top 3 projects (e.g., KAFKA, HADOOP, SPARK)
   │
   ├── For each project:
   │   ├── CheckpointManager.loadCheckpoint(projectKey)
   │   │   ├── If exists: resume from lastStartAt
   │   │   └── If not: start from beginning
   │   │
   │   ├── JiraScraper.getTotalIssueCount(projectKey)
   │   │   └── API call with maxResults=0 (just count)
   │   │
   │   ├── Loop: Fetch all pages
   │   │   ├── RateLimiter.wait() ← enforce delay
   │   │   ├── ApiClient.get('/search', { jql, startAt, maxResults })
   │   │   │   ├── On error: retry with backoff (5 attempts)
   │   │   │   └── On 429: wait for retry-after header
   │   │   │
   │   │   ├── For each issue in page:
   │   │   │   ├── ApiClient.get(`/issue/${key}/comment`)
   │   │   │   └── Attach comments to issue object
   │   │   │
   │   │   ├── Update progress bar
   │   │   │
   │   │   └── CheckpointManager.shouldSave()
   │   │       └── If yes: save checkpoint atomically
   │   │
   │   └── Save to: data/raw/{PROJECT}_issues.json

3. PROCESSING PHASE
   ├── Load config from config/config.yaml
   │
   ├── GeminiClient.test_connection()
   │   └── Verify API key is valid
   │
   ├── For each project file in data/raw/:
   │   ├── Load JSON: issues = json.load(file)
   │   │
   │   ├── Quality check: validate_issue_data(issues)
   │   │
   │   ├── For each issue:
   │   │   ├── TaskGenerator.format_issue_context(issue)
   │   │   │   ├── Extract: key, summary, description, comments
   │   │   │   ├── Truncate long text (>3000 chars)
   │   │   │   └── Return formatted context string
   │   │   │
   │   │   ├── GeminiClient.generate_summary(context)
   │   │   │   ├── Call API with summarization prompt
   │   │   │   └── Return 2-3 sentence summary
   │   │   │
   │   │   ├── GeminiClient.generate_classification(context)
   │   │   │   ├── Call API with classification prompt
   │   │   │   └── Parse JSON response
   │   │   │
   │   │   ├── GeminiClient.generate_qna_pairs(context, num=5)
   │   │   │   ├── Call API with Q&A prompt
   │   │   │   └── Parse JSON array
   │   │   │
   │   │   └── TaskGenerator.create_*_task()
   │   │       └── Format as training example dict
   │   │
   │   └── DataTransformer.transform_to_jsonl(tasks, output_file)
   │       ├── Write one JSON object per line
   │       └── Validate structure
   │
   └── Merge all project files into combined_training.jsonl

4. STATISTICS GENERATION
   └── Print summary: total examples, task breakdown, file sizes
```

### File Formats

**Scraped Data (JSON)**:
```json
[
  {
    "key": "KAFKA-19703",
    "fields": {
      "summary": "...",
      "description": "...",
      "issuetype": { "name": "Improvement" },
      "priority": { "name": "Minor" },
      ...
    },
    "comments": [
      { "author": {...}, "body": "..." },
      ...
    ]
  },
  ...
]
```

**Training Data (JSONL)**:
```jsonl
{"task_type":"summarization","instruction":"...","input":"...","output":"...","metadata":{...}}
{"task_type":"classification","instruction":"...","input":"...","output":"...","metadata":{...}}
{"task_type":"qna","instruction":"...","input":{...},"output":"...","metadata":{...}}
```

---

## Checkpoint Strategy

### Design Goals

1. **Never lose progress** - even if killed mid-batch
2. **Fast recovery** - resume in seconds, not minutes
3. **Minimal overhead** - don't slow down scraping significantly
4. **Atomic updates** - no corrupted checkpoints

### Implementation

**Checkpoint Structure**:
```json
{
  "project": "KAFKA",
  "lastStartAt": 2500,
  "lastProcessedIssue": "KAFKA-15432",
  "totalIssues": 18584,
  "scrapedCount": 2543,
  "lastSuccessfulFetch": "2025-11-02T14:23:45Z",
  "lastUpdateCheck": "2025-11-02T00:00:00Z",
  "partialBatch": [],
  "status": "in_progress"
}
```

**Save Strategy**:
1. Save every 25 issues (configurable via `checkpoint.save_interval`)
2. Atomic write: `write to temp.json → rename to checkpoint.json`
3. On interruption: partial batch is included in checkpoint
4. On completion: status = "completed"

**Load Strategy**:
1. Check if checkpoint exists
2. If yes: resume from `lastStartAt`
3. If no: start from beginning
4. If status = "completed" and incremental_update = false: skip project

**Why Every 25 Issues?**
- **Too frequent** (e.g., every 1): High I/O overhead, slower scraping
- **Too rare** (e.g., every 1000): Risk losing significant progress
- **25 is sweet spot**: ~30 seconds of work, minimal overhead

**Atomic Writes**:
```javascript
// Write to temp file
await fs.writeFile(tempPath, JSON.stringify(checkpoint));

// Atomic rename (POSIX guarantees atomicity)
await fs.rename(tempPath, checkpointPath);
```

This prevents corruption if process is killed during write.

---

## Concurrency Model

### Scraping Concurrency

**p-limit** is used to control concurrency:

```javascript
import pLimit from 'p-limit';

const limit = pLimit(10); // Max 10 concurrent requests

// Fetch comments for 50 issues in parallel (but max 10 at once)
const tasks = issues.map(issue => 
  limit(() => fetchComments(issue.key))
);

await Promise.all(tasks);
```

**Why p-limit over Promise.all?**
- Promise.all would fire 50 requests simultaneously
- p-limit ensures only 10 are in-flight at any time
- Prevents overwhelming API and local resources

**Configuration**:
```yaml
scraping:
  max_concurrent_requests: 10
```

**Tuning**:
- **Higher** (e.g., 15): Faster, but may hit rate limits
- **Lower** (e.g., 5): Slower, but more respectful

### LLM Processing Concurrency

Currently **sequential** (one issue at a time):

```python
for issue in issues:
    tasks = task_generator.process_issue(issue)
```

**Why not parallel?**
- Gemini API has rate limits even with pro account
- Sequential processing is easier to debug
- Still reasonably fast (~80 issues/min)

**Future Enhancement**:
- Could use `asyncio` + `aiohttp` for parallel Gemini calls
- Would require careful rate limit management

---

## Rate Limiting

### Token Bucket Algorithm

Implemented in `RateLimiter.js`:

```javascript
class RateLimiter {
  constructor(delayMs = 100, maxBurst = 10) {
    this.tokens = maxBurst;
    this.delayMs = delayMs;
  }
  
  async wait() {
    // Refill tokens based on time elapsed
    const tokensToAdd = timeSinceLastRequest / this.delayMs;
    this.tokens = Math.min(this.tokens + tokensToAdd, maxBurst);
    
    // If no tokens, wait
    if (this.tokens <= 0) {
      await sleep(waitTime);
    }
    
    this.tokens--;
  }
}
```

**How it works**:
1. Start with 10 tokens (burst capacity)
2. Each request consumes 1 token
3. Tokens regenerate at 1 per 100ms (10 per second)
4. Allows bursts of 10 requests, then enforces steady rate

**Benefits**:
- Handles bursty traffic naturally
- Smoother than simple delay between requests
- Self-adjusting based on actual timing

### API-Specific Rate Limiting

**Jira API**:
- No published rate limits for public Apache instance
- Conservative defaults: 100ms delay (10 req/sec)
- Respects `Retry-After` header on 429 responses

**Gemini API**:
- Pro account: very high limits (thousands per minute)
- Retry logic handles transient errors
- Temperature = 0.3 for consistency (less randomness)

---

## Error Recovery

### Error Classification

**Retryable Errors** (auto-retry with backoff):
- HTTP 408 (Request Timeout)
- HTTP 429 (Too Many Requests)
- HTTP 500, 502, 503, 504 (Server Errors)
- Network failures (ECONNRESET, ETIMEDOUT)

**Non-Retryable Errors** (fail fast):
- HTTP 400 (Bad Request)
- HTTP 401 (Unauthorized)
- HTTP 404 (Not Found)
- Malformed JSON in response

### Exponential Backoff

Formula: `delay = base * (2 ^ attempt)`

```
Attempt 1: 2s
Attempt 2: 4s
Attempt 3: 8s
Attempt 4: 16s
Attempt 5: 32s (max)
```

**Implementation**:
```javascript
async retryRequest(requestFn, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      if (!isRetryable(error) || attempt === maxRetries) {
        throw error;
      }
      
      const delay = Math.min(2 ** attempt, 32) * 1000;
      await sleep(delay);
    }
  }
}
```

### Graceful Degradation

**Missing Comments**:
- Log warning
- Set `comments = []`
- Continue processing issue

**Malformed Issue Data**:
- Log error
- Skip issue
- Continue with next issue

**LLM API Failure**:
- Retry 5 times
- If still fails: skip issue, log error
- Continue with next issue

### State Preservation

On any critical error:
1. Save current checkpoint
2. Log full error details
3. Exit with non-zero code
4. User can resume later

---

## Incremental Update Logic

### Problem

After initial scrape (60k issues), how to fetch only new/updated issues?

### Solution

**Track Last Update Time**:
```json
{
  "lastUpdateCheck": "2025-11-02T00:00:00Z"
}
```

**JQL Query**:
```sql
project=KAFKA AND updated >= "2025-11-02 00:00:00"
ORDER BY updated ASC
```

**Merge Strategy**:
1. Load existing data: `oldIssues = JSON.parse(file)`
2. Fetch updated issues: `newIssues = API.search(jql)`
3. Create map: `issueMap = new Map(oldIssues.map(i => [i.key, i]))`
4. Update/add: `newIssues.forEach(i => issueMap.set(i.key, i))`
5. Save merged: `JSON.stringify([...issueMap.values()])`

### Implementation

```javascript
class IncrementalUpdater {
  async fetchUpdatedIssues(projectKey, since) {
    const jql = `project=${projectKey} AND updated >= "${since}"`;
    // ... paginate through results
  }
  
  async mergeWithExisting(newIssues, existingFile) {
    const oldIssues = await loadJSON(existingFile);
    const issueMap = new Map();
    
    oldIssues.forEach(i => issueMap.set(i.key, i));
    newIssues.forEach(i => issueMap.set(i.key, i)); // Overwrites old
    
    return [...issueMap.values()];
  }
}
```

### Re-Processing

After incremental scrape:
1. Identify changed issue keys
2. Re-run LLM processor only on changed issues
3. Update JSONL file (replace old examples)

---

## LLM Integration

### Why Gemini 2.0 Flash Experimental?

**Advantages**:
- **Speed**: Fastest model in Gemini family
- **Cost**: Very affordable (pro account)
- **Quality**: Excellent for structured tasks
- **Availability**: Generally available, no waitlist

**Alternatives Considered**:
- GPT-4: More expensive, slower
- Claude: Rate limits on API
- Open-source LLMs: Require local GPU, slower

### Prompt Engineering

**Design Principles**:
1. **Be Specific**: Clear task definition
2. **Provide Structure**: JSON output format specified
3. **Give Examples**: Show desired output
4. **Constrain Output**: "exactly 2-3 sentences", "exactly 5 Q&A pairs"
5. **Set Tone**: "technical", "factual", "concise"

**Temperature = 0.3**:
- Lower temperature = more consistent, less creative
- Good for factual tasks (summarization, classification)
- Bad for creative writing (not our use case)

### Task Diversity

**Why 8 tasks per issue?**
- 1 × Summary: Tests comprehension
- 2 × Classification: Tests categorization (type + priority)
- 5 × Q&A: Tests different aspects (what, why, how, when, who)

**Total**: 60,000 issues × 8 tasks = 480,000 training examples

### Quality Control

**Validation**:
- Check all required fields present
- Verify output is not empty
- Ensure JSON structure is valid

**Fallbacks**:
- If JSON parse fails: use default classification
- If Q&A generation fails: skip issue
- Log all failures for manual review

---

## Scalability Analysis

### Could This Handle 1 Million Issues?

**Yes**, with some considerations:

**Scraping**:
- ✅ Streaming processing: memory usage is constant
- ✅ Checkpoints work at any scale
- ⚠️  Time: ~3-4 days for 1M issues at current rate
- ⚠️  Disk: ~50 GB for raw JSON

**LLM Processing**:
- ✅ Streaming JSONL output: memory-efficient
- ⚠️  Time: ~6-8 days for 1M issues
- ⚠️  Cost: Gemini API costs (still reasonable with Flash model)
- ⚠️  Disk: ~80-100 GB for final JSONL

**Optimizations for 1M+ Scale**:
1. **Parallel Projects**: Run multiple scrapers simultaneously
2. **Distributed Processing**: Split projects across machines
3. **Database Storage**: Use PostgreSQL instead of JSON files
4. **Caching**: Cache API responses to avoid re-fetching
5. **Batch LLM Calls**: Use Gemini batch API (if available)

### Bottlenecks

**Current**:
1. **Jira API**: Rate limiting (mitigated by respectful delays)
2. **Gemini API**: Rate limits (even with pro)
3. **Disk I/O**: Writing large JSON files (not critical)

**At 10M+ Scale**:
1. **Storage**: Would need database, not file system
2. **Coordination**: Would need job queue (e.g., Redis)
3. **Monitoring**: Would need centralized logging (e.g., ELK stack)

---

## Trade-offs & Alternatives

### Design Decision 1: Two Languages vs One

**Chosen**: JavaScript + Python

**Alternative**: Pure Python
- **Pros**: Single environment, easier deployment
- **Cons**: `aiohttp` less mature than `axios`, no official Gemini SDK quality

**Alternative**: Pure JavaScript
- **Pros**: Single environment, consistent code style
- **Cons**: Gemini SDK not as good, Python ecosystem better for AI

**Verdict**: Two languages, best tool for each job.

---

### Design Decision 2: Checkpoints Every 25 Issues

**Chosen**: 25 issues

**Alternative**: Every issue
- **Pros**: Never lose more than 1 issue
- **Cons**: 2400× more I/O, significant performance impact

**Alternative**: Every 1000 issues
- **Pros**: Minimal overhead
- **Cons**: Lose up to 1000 issues of progress

**Verdict**: 25 is optimal balance (measured experimentally).

---

### Design Decision 3: Atomic Checkpoint Writes

**Chosen**: Write to temp → rename

**Alternative**: Direct write
- **Pros**: Simpler code
- **Cons**: Risk of corruption if killed mid-write

**Alternative**: Write-ahead log
- **Pros**: Even safer
- **Cons**: Overkill for this use case

**Verdict**: Temp file + rename is POSIX standard, simple and safe.

---

### Design Decision 4: Sequential LLM Processing

**Chosen**: One issue at a time

**Alternative**: Parallel processing
- **Pros**: Faster
- **Cons**: Complex rate limit management, harder to debug

**Alternative**: Batch API calls
- **Pros**: Very fast
- **Cons**: Not supported by Gemini API yet

**Verdict**: Sequential is simple and fast enough.

---

### Design Decision 5: JSONL Output Format

**Chosen**: JSONL (one JSON per line)

**Alternative**: Single JSON array
- **Pros**: Easier to parse in some languages
- **Cons**: Must load entire file into memory

**Alternative**: CSV
- **Pros**: Smaller file size
- **Cons**: Nested structures (metadata) are awkward

**Alternative**: SQLite database
- **Pros**: Queryable, indexable
- **Cons**: More complex, harder to share

**Verdict**: JSONL is industry standard for ML training data.

---

## Summary

The Jira LLM Pipeline is designed for **reliability** and **resumability** at scale:

- ✅ Two-phase architecture (scrape → process)
- ✅ Checkpoint-based recovery
- ✅ Exponential backoff retry
- ✅ Rate limiting and respectful API usage
- ✅ Streaming processing (memory-efficient)
- ✅ Comprehensive error handling
- ✅ Incremental update support
- ✅ Production-ready logging and monitoring

**Next Steps**: See `EDGE_CASES.md` for exhaustive list of handled scenarios.

---

*This document describes the system as of November 2, 2025.*

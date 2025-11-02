"""
Task generator for creating LLM training examples
Features:
- Generate summarization tasks
- Generate classification tasks
- Generate Q&A pairs
- Format issues into readable context
"""

from typing import Dict, List, Optional
from datetime import datetime
from gemini_client import GeminiClient


class TaskGenerator:
    """Generate training tasks from Jira issues"""
    
    def __init__(self, gemini_client: GeminiClient):
        """
        Initialize task generator
        
        Args:
            gemini_client: Configured Gemini API client
        """
        self.gemini_client = gemini_client
        self.stats = {
            'total_issues': 0,
            'total_tasks': 0,
            'summarization_tasks': 0,
            'classification_tasks': 0,
            'qna_tasks': 0,
            'errors': 0
        }
    
    def process_issue(self, issue: Dict, config: Dict) -> List[Dict]:
        """
        Generate all derived tasks for a single issue
        
        Creates:
        - 1 summarization task
        - 2 classification tasks (type + priority)
        - 5 Q&A pairs
        
        Total: 8 training examples per issue
        
        Args:
            issue: Jira issue object
            config: Task configuration
            
        Returns:
            List of training task dictionaries
        """
        tasks = []
        
        try:
            self.stats['total_issues'] += 1
            
            # Format issue into readable context
            issue_context = self.format_issue_context(issue)
            
            # 1. Generate summarization task
            if config.get('summarization', {}).get('enabled', True):
                summary_task = self._create_summarization_task(issue, issue_context)
                if summary_task:
                    tasks.append(summary_task)
                    self.stats['summarization_tasks'] += 1
            
            # 2. Generate classification tasks
            if config.get('classification', {}).get('enabled', True):
                classification_tasks = self._create_classification_tasks(issue, issue_context)
                tasks.extend(classification_tasks)
                self.stats['classification_tasks'] += len(classification_tasks)
            
            # 3. Generate Q&A pairs
            if config.get('qna', {}).get('enabled', True):
                num_pairs = config.get('qna', {}).get('pairs_per_issue', 5)
                qna_tasks = self._create_qna_tasks(issue, issue_context, num_pairs)
                tasks.extend(qna_tasks)
                self.stats['qna_tasks'] += len(qna_tasks)
            
            self.stats['total_tasks'] += len(tasks)
            
            return tasks
            
        except Exception as error:
            self.stats['errors'] += 1
            print(f"⚠️  Error processing issue {issue.get('key', 'unknown')}: {error}")
            return []
    
    def format_issue_context(self, issue: Dict) -> str:
        """
        Format issue into readable text with metadata
        
        Args:
            issue: Jira issue object
            
        Returns:
            Formatted context string
        """
        fields = issue.get('fields', {})
        
        # Extract key information
        issue_key = issue.get('key', 'UNKNOWN')
        summary = fields.get('summary', 'No summary')
        description = fields.get('description') or 'No description provided'
        
        # Handle None values for nested objects
        issue_type_obj = fields.get('issuetype') or {}
        issue_type = issue_type_obj.get('name', 'Unknown') if isinstance(issue_type_obj, dict) else 'Unknown'
        
        priority_obj = fields.get('priority') or {}
        priority = priority_obj.get('name', 'Unset') if isinstance(priority_obj, dict) else 'Unset'
        
        status_obj = fields.get('status') or {}
        status = status_obj.get('name', 'Unknown') if isinstance(status_obj, dict) else 'Unknown'
        
        # Assignee and reporter (handle None)
        assignee = fields.get('assignee')
        assignee_name = assignee.get('displayName', 'Unassigned') if assignee and isinstance(assignee, dict) else 'Unassigned'
        
        reporter = fields.get('reporter')
        reporter_name = reporter.get('displayName', 'Unknown') if reporter and isinstance(reporter, dict) else 'Unknown'
        
        # Components
        components = fields.get('components', [])
        component_names = [c.get('name', '') for c in components]
        component_str = ', '.join(component_names) if component_names else 'None'
        
        # Labels
        labels = fields.get('labels', [])
        labels_str = ', '.join(labels) if labels else 'None'
        
        # Comments (handle None and missing fields)
        comments = issue.get('comments', [])
        if comments is None:
            comments = []
        comments_text = ''
        if comments and len(comments) > 0:
            # Include first 3 comments (most relevant)
            for idx, comment in enumerate(comments[:3], 1):
                if comment and isinstance(comment, dict):
                    author_obj = comment.get('author') or {}
                    author = author_obj.get('displayName', 'Unknown') if isinstance(author_obj, dict) else 'Unknown'
                    body = comment.get('body') or ''
                    # Truncate long comments
                    if len(body) > 500:
                        body = body[:500] + '...'
                    comments_text += f"\nComment {idx} by {author}:\n{body}\n"
        
        # Truncate very long descriptions
        if len(description) > 3000:
            description = description[:3000] + '\n[... truncated for length ...]'
        
        # Build context
        context = f"""Issue: {issue_key}
Title: {summary}

Type: {issue_type}
Priority: {priority}
Status: {status}
Assignee: {assignee_name}
Reporter: {reporter_name}
Components: {component_str}
Labels: {labels_str}

Description:
{description}
"""
        
        if comments_text:
            context += f"\n{comments_text}"
        
        return context
    
    def _create_summarization_task(self, issue: Dict, context: str) -> Optional[Dict]:
        """Create summarization training task"""
        try:
            # Generate summary using Gemini
            summary = self.gemini_client.generate_summary(context)
            
            return {
                "task_type": "summarization",
                "instruction": "Summarize the following software issue in 2-3 sentences.",
                "input": context,
                "output": summary,
                "metadata": self._create_metadata(issue)
            }
        except Exception as error:
            print(f"⚠️  Failed to create summarization task: {error}")
            return None
    
    def _create_classification_tasks(self, issue: Dict, context: str) -> List[Dict]:
        """Create classification training tasks"""
        tasks = []
        
        try:
            # Generate classification using Gemini
            classification = self.gemini_client.generate_classification(context)
            
            # Task 1: Type classification
            tasks.append({
                "task_type": "classification",
                "instruction": "Classify the type of this software issue.",
                "input": context,
                "output": classification.get('type', 'task'),
                "metadata": {
                    **self._create_metadata(issue),
                    "classification_type": "issue_type",
                    "reasoning": classification.get('reasoning', '')
                }
            })
            
            # Task 2: Priority classification
            tasks.append({
                "task_type": "classification",
                "instruction": "Classify the priority level of this software issue.",
                "input": context,
                "output": classification.get('priority', 'minor'),
                "metadata": {
                    **self._create_metadata(issue),
                    "classification_type": "priority",
                    "component": classification.get('component', '')
                }
            })
            
        except Exception as error:
            print(f"⚠️  Failed to create classification tasks: {error}")
        
        return tasks
    
    def _create_qna_tasks(self, issue: Dict, context: str, num_pairs: int) -> List[Dict]:
        """Create Q&A training tasks"""
        tasks = []
        
        try:
            # Generate Q&A pairs using Gemini
            qna_pairs = self.gemini_client.generate_qna_pairs(context, num_pairs)
            
            for pair in qna_pairs:
                if 'question' in pair and 'answer' in pair:
                    tasks.append({
                        "task_type": "qna",
                        "instruction": "Answer the following question based on the software issue context.",
                        "input": {
                            "context": context,
                            "question": pair['question']
                        },
                        "output": pair['answer'],
                        "metadata": self._create_metadata(issue)
                    })
        except Exception as error:
            print(f"⚠️  Failed to create Q&A tasks: {error}")
        
        return tasks
    
    def _create_metadata(self, issue: Dict) -> Dict:
        """Create metadata for training task"""
        fields = issue.get('fields', {})
        
        return {
            "issue_key": issue.get('key', 'UNKNOWN'),
            "project": issue.get('key', 'UNKNOWN').split('-')[0],
            "issue_type": fields.get('issuetype', {}).get('name', 'Unknown'),
            "priority": fields.get('priority', {}).get('name', 'Unknown'),
            "created": fields.get('created', ''),
            "model": self.gemini_client.model_name,
            "generated_at": datetime.utcnow().isoformat() + 'Z'
        }
    
    def validate_output(self, task: Dict) -> bool:
        """
        Basic validation of task output
        
        Args:
            task: Training task dictionary
            
        Returns:
            True if valid
        """
        required_fields = ['task_type', 'instruction', 'input', 'output', 'metadata']
        
        # Check all required fields present
        for field in required_fields:
            if field not in task:
                return False
        
        # Check output is not empty
        if not task['output']:
            return False
        
        return True
    
    def get_statistics(self) -> Dict:
        """Get processing statistics"""
        return self.stats.copy()
    
    def print_statistics(self):
        """Print processing statistics"""
        print("\n" + "=" * 60)
        print("TASK GENERATION STATISTICS")
        print("=" * 60)
        print(f"Total Issues Processed: {self.stats['total_issues']:,}")
        print(f"Total Tasks Generated: {self.stats['total_tasks']:,}")
        print(f"  - Summarization: {self.stats['summarization_tasks']:,}")
        print(f"  - Classification: {self.stats['classification_tasks']:,}")
        print(f"  - Q&A: {self.stats['qna_tasks']:,}")
        print(f"Errors: {self.stats['errors']}")
        print("=" * 60)

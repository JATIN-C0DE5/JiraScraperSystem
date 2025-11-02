"""
Basic validation utilities for data quality checks
"""

from typing import Dict, List, Any


def validate_issue_data(issue: Dict) -> bool:
    """
    Validate Jira issue data structure
    
    Args:
        issue: Jira issue dictionary
        
    Returns:
        True if valid
    """
    # Check required fields
    if 'key' not in issue:
        return False
    
    if 'fields' not in issue:
        return False
    
    fields = issue['fields']
    
    # Check essential fields exist
    essential = ['summary', 'issuetype', 'created']
    for field in essential:
        if field not in fields:
            return False
    
    return True


def validate_training_task(task: Dict) -> bool:
    """
    Validate training task structure
    
    Args:
        task: Training task dictionary
        
    Returns:
        True if valid
    """
    required_fields = ['task_type', 'instruction', 'input', 'output', 'metadata']
    
    for field in required_fields:
        if field not in task:
            return False
    
    # Check task type is valid
    valid_types = ['summarization', 'classification', 'qna']
    if task['task_type'] not in valid_types:
        return False
    
    # Check output is not empty
    if not task['output']:
        return False
    
    return True


def sanitize_text(text: str, max_length: int = 10000) -> str:
    """
    Sanitize text by removing control characters and limiting length
    
    Args:
        text: Input text
        max_length: Maximum allowed length
        
    Returns:
        Sanitized text
    """
    if not isinstance(text, str):
        text = str(text)
    
    # Remove null bytes and other control characters
    text = text.replace('\x00', '')
    text = ''.join(char for char in text if ord(char) >= 32 or char in '\n\r\t')
    
    # Truncate if too long
    if len(text) > max_length:
        text = text[:max_length] + '\n[... truncated for length ...]'
    
    return text


def check_data_quality(issues: List[Dict]) -> Dict[str, Any]:
    """
    Analyze data quality of issue list
    
    Args:
        issues: List of Jira issues
        
    Returns:
        Quality report dictionary
    """
    report = {
        'total_issues': len(issues),
        'valid_issues': 0,
        'missing_description': 0,
        'missing_summary': 0,
        'no_comments': 0,
        'empty_issues': 0
    }
    
    for issue in issues:
        if not validate_issue_data(issue):
            report['empty_issues'] += 1
            continue
        
        report['valid_issues'] += 1
        
        fields = issue.get('fields', {})
        
        if not fields.get('description'):
            report['missing_description'] += 1
        
        if not fields.get('summary'):
            report['missing_summary'] += 1
        
        if not issue.get('comments'):
            report['no_comments'] += 1
    
    return report


def print_quality_report(report: Dict[str, Any]):
    """
    Print data quality report
    
    Args:
        report: Quality report dictionary
    """
    print("\n" + "=" * 60)
    print("DATA QUALITY REPORT")
    print("=" * 60)
    print(f"Total Issues: {report['total_issues']:,}")
    print(f"Valid Issues: {report['valid_issues']:,}")
    print(f"Empty/Invalid: {report['empty_issues']}")
    print(f"Missing Description: {report['missing_description']}")
    print(f"Missing Summary: {report['missing_summary']}")
    print(f"No Comments: {report['no_comments']}")
    
    if report['total_issues'] > 0:
        quality_score = (report['valid_issues'] / report['total_issues']) * 100
        print(f"\nQuality Score: {quality_score:.1f}%")
    
    print("=" * 60)

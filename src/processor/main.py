#!/usr/bin/env python3
"""
Main entry point for LLM processor
Processes scraped Jira data into LLM training examples
"""

import os
import sys
import json
import yaml
from pathlib import Path
from tqdm import tqdm

# Add src directory to path for imports
src_dir = Path(__file__).parent.parent
sys.path.insert(0, str(src_dir))
sys.path.insert(0, str(Path(__file__).parent))

from gemini_client import GeminiClient
from task_generator import TaskGenerator
from data_transformer import DataTransformer
from utils.validator import check_data_quality, print_quality_report


def load_config():
    """Load configuration from YAML file"""
    config_path = Path('config/config.yaml')
    
    if not config_path.exists():
        print(f"❌ Configuration file not found: {config_path}")
        sys.exit(1)
    
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    return config


def load_scraped_data(project_key: str, data_dir: str = 'data/raw') -> list:
    """
    Load scraped issue data for a project
    
    Args:
        project_key: Project key
        data_dir: Directory containing scraped data
        
    Returns:
        List of issues
    """
    # Try final file first
    file_path = Path(data_dir) / f'{project_key}_issues.json'
    
    # If not found, try partial file
    if not file_path.exists():
        partial_path = Path(data_dir) / f'{project_key}_issues_partial.json'
        if partial_path.exists():
            file_path = partial_path
            print(f"ℹ️  Using partial file (scraping in progress): {file_path.name}")
        else:
            print(f"⚠️  Data file not found: {file_path}")
            print(f"⚠️  Partial file also not found: {partial_path}")
            return []
    
    try:
        with open(file_path, 'r') as f:
            issues = json.load(f)
        
        print(f"✓ Loaded {len(issues):,} issues from {file_path.name}")
        return issues
    except Exception as error:
        print(f"❌ Failed to load data from {file_path}: {error}")
        return []


def get_project_list(config: dict) -> list:
    """
    Get list of projects to process
    
    Args:
        config: Configuration dictionary
        
    Returns:
        List of project keys
    """
    projects_file = Path('config/projects.json')
    
    if projects_file.exists():
        try:
            with open(projects_file, 'r') as f:
                projects_config = json.load(f)
            
            selected = projects_config.get('selected_projects', [])
            if selected:
                return selected
        except Exception as error:
            print(f"⚠️  Failed to read projects.json: {error}")
    
    # Fallback: scan data/raw directory
    data_dir = Path('data/raw')
    if data_dir.exists():
        # Look for both final and partial files
        issue_files = list(data_dir.glob('*_issues.json'))
        partial_files = list(data_dir.glob('*_issues_partial.json'))
        
        # Extract project names from both types
        projects = [f.stem.replace('_issues', '') for f in issue_files]
        projects.extend([f.stem.replace('_issues_partial', '') for f in partial_files])
        
        # Remove duplicates and return
        return list(set(projects))
    
    return []


def process_project(project_key: str, config: dict, gemini_client: GeminiClient) -> int:
    """
    Process all issues from a project
    
    Args:
        project_key: Project key
        config: Configuration dictionary
        gemini_client: Gemini API client
        
    Returns:
        Number of tasks generated
    """
    print(f"\n{'=' * 60}")
    print(f"Processing project: {project_key}")
    print('=' * 60)
    
    # Load scraped data
    issues = load_scraped_data(project_key)
    
    if not issues:
        print(f"⚠️  No issues found for {project_key}, skipping...")
        return 0
    
    # Quality check
    quality_report = check_data_quality(issues)
    print_quality_report(quality_report)
    
    # Initialize task generator
    task_generator = TaskGenerator(gemini_client)
    
    # Process all issues
    all_tasks = []
    
    print(f"\nGenerating training tasks...")
    for issue in tqdm(issues, desc=f"{project_key}", unit="issue"):
        tasks = task_generator.process_issue(issue, config['tasks'])
        all_tasks.extend(tasks)
    
    # Print task generation statistics
    task_generator.print_statistics()
    
    # Save to JSONL
    output_dir = Path(config['output']['directory'])
    output_file = output_dir / f'{project_key}_training.jsonl'
    
    transformer = DataTransformer()
    transformer.transform_to_jsonl(all_tasks, str(output_file))
    
    # Validate output
    print(f"\nValidating output file...")
    transformer.validate_jsonl_file(str(output_file))
    
    # Print statistics
    transformer.print_statistics_report(str(output_file))
    
    return len(all_tasks)


def main():
    """Main processing function"""
    print("🤖 Jira LLM Pipeline - Processor\n")
    
    # Load configuration
    print("Loading configuration...")
    config = load_config()
    print("✓ Configuration loaded\n")
    
    # Check for API key
    api_key = os.getenv(config['gemini']['api_key_env'])
    if not api_key:
        print(f"❌ {config['gemini']['api_key_env']} environment variable not set")
        print(f"Please set it: export {config['gemini']['api_key_env']}='your-key-here'")
        sys.exit(1)
    
    # Initialize Gemini client
    print("Initializing Gemini API client...")
    gemini_client = GeminiClient(
        api_key=api_key,
        model=config['gemini']['model'],
        temperature=config['gemini']['temperature'],
        max_retries=config['gemini']['max_retries'],
        timeout=config['gemini']['timeout']
    )
    
    # Test connection
    print("Testing API connection...")
    if not gemini_client.test_connection():
        print("❌ Failed to connect to Gemini API")
        sys.exit(1)
    print("✓ API connection successful\n")
    
    # Get project list
    projects = get_project_list(config)
    
    if not projects:
        print("❌ No projects found to process")
        print("Please run the scraper first: npm run scrape")
        sys.exit(1)
    
    print(f"Found {len(projects)} projects to process: {', '.join(projects)}\n")
    
    # Process each project
    total_tasks = 0
    
    for project_key in projects:
        try:
            tasks_generated = process_project(project_key, config, gemini_client)
            total_tasks += tasks_generated
            print(f"✓ Completed processing {project_key}")
        except Exception as error:
            print(f"❌ Failed to process {project_key}: {error}")
            # Continue with next project
    
    # Create combined file if configured
    if config['output'].get('combined_file', False):
        print(f"\n{'=' * 60}")
        print("Creating combined training file...")
        print('=' * 60)
        
        output_dir = Path(config['output']['directory'])
        project_files = [
            str(output_dir / f'{proj}_training.jsonl')
            for proj in projects
        ]
        
        combined_file = output_dir / 'combined_training.jsonl'
        
        transformer = DataTransformer()
        transformer.merge_project_files(project_files, str(combined_file))
        
        # Print combined statistics
        transformer.print_statistics_report(str(combined_file))
    
    # Final summary
    print(f"\n{'=' * 60}")
    print("PROCESSING COMPLETE")
    print('=' * 60)
    print(f"Total Training Examples Generated: {total_tasks:,}")
    print(f"Output Directory: {config['output']['directory']}")
    print('=' * 60)
    print("\n✅ LLM processing completed successfully!")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(0)
    except Exception as error:
        print(f"\n❌ Fatal error: {error}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

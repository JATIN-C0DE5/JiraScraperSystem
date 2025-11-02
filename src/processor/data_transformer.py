"""
Data transformer for creating JSONL training files
Features:
- Convert tasks to JSONL format
- Merge multiple project files
- Generate statistics
- Stream processing for large datasets
"""

import json
import jsonlines
from pathlib import Path
from typing import List, Dict


class DataTransformer:
    """Transform processed tasks into JSONL training format"""
    
    def __init__(self):
        """Initialize data transformer"""
        self.stats = {
            'files_created': 0,
            'total_examples': 0,
            'task_type_counts': {}
        }
    
    def transform_to_jsonl(self, tasks: List[Dict], output_file: str):
        """
        Write tasks to JSONL file (one JSON object per line)
        
        Args:
            tasks: List of training task dictionaries
            output_file: Output file path
        """
        try:
            # Ensure output directory exists
            output_path = Path(output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Write JSONL file
            with jsonlines.open(output_file, mode='w') as writer:
                for task in tasks:
                    writer.write(task)
                    
                    # Update statistics
                    task_type = task.get('task_type', 'unknown')
                    self.stats['task_type_counts'][task_type] = \
                        self.stats['task_type_counts'].get(task_type, 0) + 1
            
            self.stats['files_created'] += 1
            self.stats['total_examples'] += len(tasks)
            
            print(f"✓ Wrote {len(tasks):,} training examples to {output_file}")
            
        except Exception as error:
            print(f"❌ Failed to write JSONL file {output_file}: {error}")
            raise
    
    def append_to_jsonl(self, tasks: List[Dict], output_file: str):
        """
        Append tasks to existing JSONL file
        
        Args:
            tasks: List of training task dictionaries
            output_file: Output file path
        """
        try:
            # Ensure output directory exists
            output_path = Path(output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Append to JSONL file
            with jsonlines.open(output_file, mode='a') as writer:
                for task in tasks:
                    writer.write(task)
                    
                    # Update statistics
                    task_type = task.get('task_type', 'unknown')
                    self.stats['task_type_counts'][task_type] = \
                        self.stats['task_type_counts'].get(task_type, 0) + 1
            
            self.stats['total_examples'] += len(tasks)
            
            print(f"✓ Appended {len(tasks):,} training examples to {output_file}")
            
        except Exception as error:
            print(f"❌ Failed to append to JSONL file {output_file}: {error}")
            raise
    
    def merge_project_files(self, project_files: List[str], output: str):
        """
        Combine multiple JSONL files into one
        
        Args:
            project_files: List of input file paths
            output: Output file path
        """
        try:
            print(f"\nMerging {len(project_files)} project files...")
            
            total_count = 0
            
            # Ensure output directory exists
            output_path = Path(output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Merge files
            with jsonlines.open(output, mode='w') as writer:
                for file_path in project_files:
                    if not Path(file_path).exists():
                        print(f"⚠️  File not found: {file_path}, skipping...")
                        continue
                    
                    with jsonlines.open(file_path) as reader:
                        for obj in reader:
                            writer.write(obj)
                            total_count += 1
            
            print(f"✓ Merged {total_count:,} examples into {output}")
            
        except Exception as error:
            print(f"❌ Failed to merge files: {error}")
            raise
    
    def generate_statistics(self, jsonl_file: str) -> Dict:
        """
        Generate statistics report for a JSONL file
        
        Args:
            jsonl_file: Path to JSONL file
            
        Returns:
            Statistics dictionary
        """
        try:
            stats = {
                'total_examples': 0,
                'task_types': {},
                'projects': {},
                'avg_input_length': 0,
                'avg_output_length': 0
            }
            
            total_input_len = 0
            total_output_len = 0
            
            with jsonlines.open(jsonl_file) as reader:
                for obj in reader:
                    stats['total_examples'] += 1
                    
                    # Count task types
                    task_type = obj.get('task_type', 'unknown')
                    stats['task_types'][task_type] = \
                        stats['task_types'].get(task_type, 0) + 1
                    
                    # Count projects
                    project = obj.get('metadata', {}).get('project', 'unknown')
                    stats['projects'][project] = \
                        stats['projects'].get(project, 0) + 1
                    
                    # Calculate lengths
                    input_text = obj.get('input', '')
                    if isinstance(input_text, dict):
                        input_text = str(input_text)
                    total_input_len += len(input_text)
                    
                    output_text = str(obj.get('output', ''))
                    total_output_len += len(output_text)
            
            # Calculate averages
            if stats['total_examples'] > 0:
                stats['avg_input_length'] = int(total_input_len / stats['total_examples'])
                stats['avg_output_length'] = int(total_output_len / stats['total_examples'])
            
            return stats
            
        except Exception as error:
            print(f"❌ Failed to generate statistics: {error}")
            return {}
    
    def print_statistics_report(self, jsonl_file: str):
        """
        Print detailed statistics report
        
        Args:
            jsonl_file: Path to JSONL file
        """
        stats = self.generate_statistics(jsonl_file)
        
        if not stats:
            return
        
        print("\n" + "=" * 60)
        print(f"STATISTICS REPORT: {Path(jsonl_file).name}")
        print("=" * 60)
        print(f"Total Training Examples: {stats['total_examples']:,}")
        print(f"\nTask Type Breakdown:")
        for task_type, count in sorted(stats['task_types'].items()):
            percentage = (count / stats['total_examples']) * 100
            print(f"  {task_type.capitalize()}: {count:,} ({percentage:.1f}%)")
        
        print(f"\nProject Breakdown:")
        for project, count in sorted(stats['projects'].items()):
            percentage = (count / stats['total_examples']) * 100
            print(f"  {project}: {count:,} ({percentage:.1f}%)")
        
        print(f"\nAverage Lengths:")
        print(f"  Input: {stats['avg_input_length']:,} characters")
        print(f"  Output: {stats['avg_output_length']:,} characters")
        print("=" * 60)
    
    def validate_jsonl_file(self, jsonl_file: str) -> bool:
        """
        Validate JSONL file format
        
        Args:
            jsonl_file: Path to JSONL file
            
        Returns:
            True if valid
        """
        try:
            line_count = 0
            error_count = 0
            
            with jsonlines.open(jsonl_file) as reader:
                for line_num, obj in enumerate(reader, 1):
                    line_count += 1
                    
                    # Check required fields
                    required_fields = ['task_type', 'instruction', 'input', 'output']
                    missing = [f for f in required_fields if f not in obj]
                    
                    if missing:
                        error_count += 1
                        print(f"⚠️  Line {line_num}: Missing fields: {missing}")
            
            if error_count == 0:
                print(f"✓ JSONL file is valid ({line_count:,} lines)")
                return True
            else:
                print(f"⚠️  JSONL file has {error_count} errors out of {line_count} lines")
                return False
                
        except Exception as error:
            print(f"❌ Failed to validate JSONL file: {error}")
            return False
    
    def get_global_statistics(self) -> Dict:
        """Get global transformation statistics"""
        return self.stats.copy()
    
    def print_global_statistics(self):
        """Print global transformation statistics"""
        print("\n" + "=" * 60)
        print("GLOBAL TRANSFORMATION STATISTICS")
        print("=" * 60)
        print(f"Files Created: {self.stats['files_created']}")
        print(f"Total Training Examples: {self.stats['total_examples']:,}")
        
        if self.stats['task_type_counts']:
            print(f"\nTask Type Breakdown:")
            for task_type, count in sorted(self.stats['task_type_counts'].items()):
                percentage = (count / self.stats['total_examples']) * 100 if self.stats['total_examples'] > 0 else 0
                print(f"  {task_type.capitalize()}: {count:,} ({percentage:.1f}%)")
        
        print("=" * 60)

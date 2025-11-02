"""
Gemini API client with retry logic and error handling
Features:
- Uses google-generativeai official SDK
- Exponential backoff retry
- Rate limit handling
- Temperature control for consistency
"""

import os
import time
import json
from typing import Dict, List, Optional
import google.generativeai as genai


class GeminiClient:
    """Client for interacting with Google Gemini API"""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "gemini-2.0-flash-exp",
        temperature: float = 0.3,
        max_retries: int = 5,
        timeout: int = 30
    ):
        """
        Initialize Gemini client
        
        Args:
            api_key: Gemini API key (reads from GEMINI_API_KEY env if not provided)
            model: Model name
            temperature: Temperature for generation (lower = more consistent)
            max_retries: Maximum retry attempts
            timeout: Request timeout in seconds
        """
        self.api_key = api_key or os.getenv('GEMINI_API_KEY')
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")
        
        self.model_name = model
        self.temperature = temperature
        self.max_retries = max_retries
        self.timeout = timeout
        
        # Configure Gemini API
        genai.configure(api_key=self.api_key)
        
        # Initialize model
        self.model = genai.GenerativeModel(
            model_name=self.model_name,
            generation_config={
                "temperature": self.temperature,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 2048,
            }
        )
        
        print(f"✓ Gemini client initialized: {self.model_name}")
    
    def generate_summary(self, issue_text: str) -> str:
        """
        Generate concise 2-3 sentence summary of an issue
        
        Args:
            issue_text: Formatted issue text
            
        Returns:
            Summary string
        """
        prompt = f"""You are a technical writer creating training data for an AI model.

Task: Summarize this software issue in exactly 2-3 sentences.

Requirements:
- First sentence: What is the problem or feature request?
- Second sentence: Which component/module is affected?
- Third sentence (optional): Current status or proposed solution.

Be concise, technical, and factual. Do not add opinions.

Issue:
{issue_text}

Summary:"""
        
        return self._call_api_with_retry(prompt)
    
    def generate_classification(self, issue_text: str) -> Dict:
        """
        Classify issue type, priority, and component
        
        Args:
            issue_text: Formatted issue text
            
        Returns:
            Dictionary with classification fields
        """
        prompt = f"""You are creating training data for issue classification.

Task: Analyze this software issue and classify it.

Return a JSON object with:
{{
  "type": "bug|feature|improvement|task|test|documentation",
  "priority": "critical|major|minor|trivial",
  "component": "brief component name",
  "reasoning": "one sentence explanation"
}}

Issue:
{issue_text}

Classification:"""
        
        response = self._call_api_with_retry(prompt)
        
        # Parse JSON response
        try:
            # Extract JSON from response (handle cases where model adds extra text)
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            if json_start != -1 and json_end > json_start:
                json_str = response[json_start:json_end]
                return json.loads(json_str)
            else:
                # If no JSON found, return default
                return {
                    "type": "task",
                    "priority": "minor",
                    "component": "general",
                    "reasoning": "Could not parse classification"
                }
        except json.JSONDecodeError:
            return {
                "type": "task",
                "priority": "minor",
                "component": "general",
                "reasoning": "JSON parse error"
            }
    
    def generate_qna_pairs(self, issue_text: str, num_pairs: int = 5) -> List[Dict]:
        """
        Generate question-answer pairs about an issue
        
        Args:
            issue_text: Formatted issue text
            num_pairs: Number of Q&A pairs to generate
            
        Returns:
            List of dictionaries with 'question' and 'answer' keys
        """
        prompt = f"""You are creating question-answer pairs for training an AI assistant.

Task: Generate exactly {num_pairs} questions and answers about this software issue.

Requirements:
- Questions should test comprehension at different levels
- Include: factual, analytical, and technical questions
- Answers must be accurate and extractable from the issue
- Vary question types: what, why, how, who, when, which

Format as JSON array:
[
  {{"question": "...", "answer": "..."}},
  {{"question": "...", "answer": "..."}},
  ...
]

Issue:
{issue_text}

Q&A Pairs:"""
        
        response = self._call_api_with_retry(prompt)
        
        # Parse JSON response
        try:
            # Extract JSON array from response
            json_start = response.find('[')
            json_end = response.rfind(']') + 1
            if json_start != -1 and json_end > json_start:
                json_str = response[json_start:json_end]
                pairs = json.loads(json_str)
                
                # Ensure we have the right structure
                if isinstance(pairs, list) and len(pairs) > 0:
                    return pairs[:num_pairs]  # Limit to requested number
            
            # Fallback: return empty list
            return []
        except json.JSONDecodeError:
            return []
    
    def _call_api_with_retry(self, prompt: str, max_retries: Optional[int] = None) -> str:
        """
        Call Gemini API with exponential backoff retry
        
        Args:
            prompt: Prompt text
            max_retries: Override max retries
            
        Returns:
            Response text
        """
        retries = max_retries or self.max_retries
        last_error = None
        
        for attempt in range(1, retries + 1):
            try:
                response = self.model.generate_content(prompt)
                
                # Check if response has text
                if response.text:
                    return response.text.strip()
                else:
                    raise ValueError("Empty response from Gemini API")
                    
            except Exception as error:
                last_error = error
                
                # Check if we should retry
                if attempt < retries:
                    # Calculate backoff delay (2^attempt seconds)
                    delay = min(2 ** attempt, 32)
                    print(f"⚠️  API error (attempt {attempt}/{retries}), retrying in {delay}s...")
                    time.sleep(delay)
                else:
                    print(f"❌ Max retries exceeded for API call")
                    raise error
        
        raise last_error
    
    def test_connection(self) -> bool:
        """
        Test API connection
        
        Returns:
            True if successful
        """
        try:
            response = self._call_api_with_retry("Hello! Respond with 'OK' if you can read this.", max_retries=3)
            return len(response) > 0
        except Exception as error:
            print(f"Connection test failed: {error}")
            return False

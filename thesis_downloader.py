import os
import requests
import json
import logging
import csv
from typing import Optional, List, Dict, Tuple, NamedTuple
from urllib.parse import quote, urlencode, urljoin, unquote
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import time
import re
import urllib.parse
from difflib import SequenceMatcher
from dataclasses import dataclass
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ThesisMetadata:
    """Class for storing thesis metadata."""
    title: str
    author: str
    type: str
    year: str
    handle: Optional[str] = None
    abstract: Optional[str] = None
    abstract_en: Optional[str] = None
    keywords: Optional[List[str]] = None
    keywords_en: Optional[List[str]] = None
    department: Optional[str] = None
    supervisor: Optional[str] = None
    language: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    last_updated: Optional[str] = None

class ThesisDownloader:
    def __init__(self, output_dir: str = "theses"):
        """Initialize the thesis downloader.
        
        Args:
            output_dir: Directory where theses will be saved
        """
        self.base_url = "https://dspace.cvut.cz"
        self.oai_url = f"{self.base_url}/oai/request"
        self.output_dir = output_dir
        self.metadata_dir = os.path.join(output_dir, "metadata")
        os.makedirs(output_dir, exist_ok=True)
        os.makedirs(self.metadata_dir, exist_ok=True)
        
    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison by removing diacritics and special characters."""
        text = text.lower()
        # Remove diacritics
        text = ''.join(c for c in text if ord(c) < 128)
        # Remove special characters
        text = re.sub(r'[^a-z0-9\s]', '', text)
        # Normalize whitespace
        text = ' '.join(text.split())
        return text
        
    def _similarity_score(self, text1: str, text2: str) -> float:
        """Calculate similarity score between two texts."""
        text1 = self._normalize_text(text1)
        text2 = self._normalize_text(text2)
        return SequenceMatcher(None, text1, text2).ratio()

    def discover_handle(self, author: str, title: str) -> Optional[str]:
        """Discover handle by searching for a thesis by author and title using OAI-PMH."""
        # Split author name into parts and get the last name
        author_parts = author.split()
        if len(author_parts) >= 2:
            if author_parts[0][0].isupper():
                last_name = author_parts[0]
            else:
                last_name = author_parts[-1]
        else:
            last_name = author_parts[0] if author_parts else ""
        
        logger.info(f"Searching for thesis: {title} by {author} (last name: {last_name})")
        
        # Try different search strategies
        search_strategies = [
            {"set": "com_10467_3566"},  # FIT theses
            {"from": "2000-01-01"},  # All theses from 2000
            {}  # All theses
        ]
        
        for strategy in search_strategies:
            params = {
                "verb": "ListRecords",
                "metadataPrefix": "oai_dc",
                **strategy
            }
            
            try:
                response = requests.get(self.oai_url, params=params, timeout=30)
                response.raise_for_status()
                
                # Add timeout for each strategy
                start_time = time.time()
                max_time = 60  # Maximum 60 seconds per strategy
                
                while True:
                    if time.time() - start_time > max_time:
                        logger.warning(f"Timeout reached for strategy {strategy}")
                        break
                        
                    root = ET.fromstring(response.content)
                    ns = {
                        'oai': 'http://www.openarchives.org/OAI/2.0/',
                        'dc': 'http://purl.org/dc/elements/1.1/',
                        'oai_dc': 'http://www.openarchives.org/OAI/2.0/oai_dc/'
                    }
                    
                    records = root.findall('.//oai:record', ns)
                    best_match = None
                    best_score = 0
                    
                    for record in records:
                        metadata = record.find('.//oai_dc:dc', ns)
                        if metadata is None:
                            continue
                            
                        record_titles = [t.text for t in metadata.findall('dc:title', ns) if t.text]
                        record_creators = [c.text for c in metadata.findall('dc:creator', ns) if c.text]
                        
                        # Calculate similarity scores
                        title_scores = [self._similarity_score(title, t) for t in record_titles]
                        creator_scores = [self._similarity_score(last_name, c.split()[-1]) for c in record_creators]
                        
                        if title_scores and creator_scores:
                            score = max(title_scores) * 0.6 + max(creator_scores) * 0.4
                            if score > best_score and score > 0.8:  # Threshold for good match
                                best_score = score
                                identifier = record.find('.//oai:identifier', ns)
                                if identifier is not None and identifier.text:
                                    best_match = identifier.text
                    
                    if best_match:
                        handle = '/'.join(best_match.split('/')[-2:])
                        logger.info(f"Found matching thesis with handle: {handle} (score: {best_score:.2f})")
                        return handle
                    
                    token = root.find('.//oai:resumptionToken', ns)
                    if token is None or not token.text:
                        break
                        
                    params = {
                        "verb": "ListRecords",
                        "resumptionToken": token.text
                    }
                    response = requests.get(self.oai_url, params=params, timeout=30)
                    response.raise_for_status()
                    
            except Exception as e:
                logger.error(f"Error in search strategy {strategy}: {e}")
                continue
        
        logger.warning(f"No handle found for thesis: {title} by {author}")
        return None

    def get_thesis_metadata(self, handle: str) -> Optional[ThesisMetadata]:
        """Get comprehensive thesis metadata using multiple sources."""
        try:
            metadata_dict = {}
            
            # Try DSpace REST API first
            response = requests.get(f"{self.base_url}/rest/handle/{handle}", timeout=30)
            if response.ok:
                data = response.json()
                metadata = data.get('metadata', {})
                
                # Extract metadata from REST API
                for key, value in metadata.items():
                    if value and isinstance(value, list) and value[0].get('value'):
                        metadata_dict[key] = value[0]['value']
            
            # Get HTML page for additional metadata
            html_response = requests.get(f"{self.base_url}/handle/{handle}", timeout=30)
            if html_response.ok:
                soup = BeautifulSoup(html_response.text, 'html.parser')
                
                # Extract all metadata fields from HTML
                metadata_table = soup.find('table', {'class': 'ds-includeSet-table'})
                if metadata_table:
                    for row in metadata_table.find_all('tr'):
                        label = row.find('td', {'class': 'label-cell'})
                        value = row.find('td', {'class': 'word-break'})
                        if label and value:
                            label_text = label.get_text(strip=True).lower()
                            value_text = value.get_text(strip=True)
                            
                            # Map common fields
                            if 'title' in label_text and not metadata_dict.get('dc.title'):
                                metadata_dict['dc.title'] = value_text
                            elif 'author' in label_text and not metadata_dict.get('dc.contributor.author'):
                                metadata_dict['dc.contributor.author'] = value_text
                            elif 'type' in label_text and not metadata_dict.get('dc.type'):
                                metadata_dict['dc.type'] = value_text
                            elif 'date' in label_text and 'issued' in label_text and not metadata_dict.get('dc.date.issued'):
                                metadata_dict['dc.date.issued'] = value_text
                            elif 'supervisor' in label_text and not metadata_dict.get('dc.contributor.advisor'):
                                metadata_dict['dc.contributor.advisor'] = value_text
                            elif 'department' in label_text and not metadata_dict.get('dc.publisher'):
                                metadata_dict['dc.publisher'] = value_text
                            elif 'language' in label_text and not metadata_dict.get('dc.language.iso'):
                                metadata_dict['dc.language.iso'] = value_text
                            elif 'keywords' in label_text:
                                if 'english' in label_text:
                                    metadata_dict['dc.subject.en'] = [k.strip() for k in value_text.split(',')]
                                else:
                                    metadata_dict['dc.subject'] = [k.strip() for k in value_text.split(',')]
                
                # Try alternative metadata extraction from HTML
                if not metadata_dict.get('dc.title'):
                    title_elem = soup.find('h2', {'class': 'page-header'})
                    if title_elem:
                        metadata_dict['dc.title'] = title_elem.get_text(strip=True)
                
                # Extract metadata from meta tags
                for meta in soup.find_all('meta'):
                    name = meta.get('name', '')
                    content = meta.get('content', '')
                    if name and content:
                        if 'DC.title' in name and not metadata_dict.get('dc.title'):
                            metadata_dict['dc.title'] = content
                        elif 'DC.creator' in name and not metadata_dict.get('dc.contributor.author'):
                            metadata_dict['dc.contributor.author'] = content
                        elif 'DC.type' in name and not metadata_dict.get('dc.type'):
                            metadata_dict['dc.type'] = content
                        elif 'DC.date' in name and not metadata_dict.get('dc.date.issued'):
                            metadata_dict['dc.date.issued'] = content
                
                # Extract abstract and English abstract
                abstracts = []
                for div in soup.find_all(['div', 'p'], {'class': ['simple-item-view-description', 'abstract', 'ds-static-div']}):
                    text = div.get_text(strip=True)
                    if text:
                        abstracts.append(text)
                
                # Try to identify Czech and English abstracts
                abstract = None
                abstract_en = None
                
                for text in abstracts:
                    # Check if the text contains typical English words
                    english_words = ['the', 'and', 'this', 'that', 'with', 'from']
                    english_count = sum(1 for word in english_words if f' {word} ' in f' {text.lower()} ')
                    czech_words = ['práce', 'byla', 'jsou', 'této', 'bylo', 'mezi']
                    czech_count = sum(1 for word in czech_words if f' {word} ' in f' {text.lower()} ')
                    
                    if english_count > czech_count:  # More English words than Czech
                        if not abstract_en:
                            abstract_en = text
                    else:
                        if not abstract:
                            abstract = text
                
                # Find PDF URL
                pdf_url = None
                for link in soup.find_all('a', href=True):
                    href = link['href']
                    if '/bitstream/handle/' in href and href.endswith('?sequence=-1&isAllowed=y'):
                        if not any(x in href.lower() for x in ['posudek', 'priloha', 'appendix']):
                            pdf_url = urljoin(self.base_url, href)
                            break
                
                # Create ThesisMetadata object
                return ThesisMetadata(
                    title=metadata_dict.get('dc.title', ''),
                    author=metadata_dict.get('dc.contributor.author', ''),
                    type=metadata_dict.get('dc.type', ''),
                    year=metadata_dict.get('dc.date.issued', '')[:4] if metadata_dict.get('dc.date.issued') else '',
                    handle=handle,
                    abstract=abstract,
                    abstract_en=abstract_en,
                    keywords=metadata_dict.get('dc.subject', []),
                    keywords_en=metadata_dict.get('dc.subject.en', []),
                    department=metadata_dict.get('dc.publisher', ''),
                    supervisor=metadata_dict.get('dc.contributor.advisor', ''),
                    language=metadata_dict.get('dc.language.iso', ''),
                    url=f"{self.base_url}/handle/{handle}",
                    pdf_url=pdf_url,
                    last_updated=datetime.now().isoformat()
                )
            
            return None
        except Exception as e:
            logger.error(f"Error getting thesis metadata: {e}")
            return None

    def save_metadata(self, metadata: ThesisMetadata):
        """Save thesis metadata to JSON file."""
        if not metadata.handle:
            return
            
        filename = f"{metadata.handle.replace('/', '_')}.json"
        filepath = os.path.join(self.metadata_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(metadata.__dict__, f, ensure_ascii=False, indent=2)

def parse_theses_file(filename):
    theses = []
    with open(filename, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
                
            parts = line.split(',')
            if len(parts) >= 4:
                author = parts[0].strip()
                
                if len(parts) >= 5:
                    handle = parts[-1].strip()
                    title = ','.join(parts[1:-3]).strip()
                else:
                    handle = None
                    title = ','.join(parts[1:-2]).strip()
                
                type_ = parts[-2].strip()
                year = parts[-1].strip()
                
                theses.append((title, author, type_, year, handle))
    return theses

def save_theses_file(filename: str, theses: List[Tuple[str, str, str, str, Optional[str]]]):
    """Save theses back to the file with handles."""
    with open(filename, 'w', encoding='utf-8') as f:
        for thesis in theses:
            title, author, thesis_type, year, handle = thesis
            parts = [author, title, thesis_type, year]
            if handle:
                parts.append(handle)
            line = ','.join(parts)
            f.write(line + '\n')

def main():
    logger.info("Starting thesis downloader...")
    
    downloader = ThesisDownloader()
    theses = parse_theses_file('mytheses.txt')
    logger.info(f"Found {len(theses)} theses in the file")
    
    discovered_handles = {}
    theses_with_handles = []
    metadata_count = 0
    
    current_year = datetime.now().year
    
    for title, author, type_, year, handle in theses:
        try:
            # Skip theses from future years
            try:
                thesis_year = int(year)
                if thesis_year > current_year:
                    logger.info(f"Skipping future thesis by {author} (year {year})")
                    theses_with_handles.append((title, author, type_, year, handle))
                    continue
            except ValueError:
                pass  # If year is not a valid integer, continue with processing
            
            current_handle = handle
            if not current_handle:
                logger.info(f"Attempting to discover handle for thesis by {author}")
                current_handle = downloader.discover_handle(author, title)
                if current_handle:
                    logger.info(f"Found handle {current_handle} for thesis by {author}")
                    discovered_handles[author] = current_handle
            
            if current_handle:
                # Get and save metadata
                metadata = downloader.get_thesis_metadata(current_handle)
                if metadata:
                    # Validate and fix metadata if needed
                    if not metadata.title and title:
                        metadata.title = title
                    if not metadata.author and author:
                        metadata.author = author
                    if not metadata.type and type_:
                        metadata.type = type_
                    if not metadata.year and year:
                        metadata.year = year
                    
                    downloader.save_metadata(metadata)
                    metadata_count += 1
                    theses_with_handles.append((title, author, type_, year, current_handle))
                else:
                    logger.warning(f"Could not get metadata for thesis by {author}")
                    theses_with_handles.append((title, author, type_, year, None))
            else:
                logger.warning(f"Could not find handle for thesis by {author}")
                theses_with_handles.append((title, author, type_, year, None))
                
        except Exception as e:
            logger.error(f"Error processing thesis {author}: {str(e)}")
            theses_with_handles.append((title, author, type_, year, None))
    
    # Save discovered handles back to the file
    logger.info("Saving updated thesis information...")
    save_theses_file('mytheses.txt', theses_with_handles)
    
    # Print summary
    logger.info("\nDownload Summary:")
    logger.info(f"Total theses processed: {len(theses)}")
    logger.info(f"Successfully found handles: {len([t for t in theses_with_handles if t[4] is not None])}")
    logger.info(f"New handles discovered: {len(discovered_handles)}")
    logger.info(f"Metadata files created: {metadata_count}")
    
    if discovered_handles:
        logger.info("\nNewly discovered handles:")
        for author, handle in discovered_handles.items():
            logger.info(f"{author}: {handle}")

if __name__ == '__main__':
    main() 
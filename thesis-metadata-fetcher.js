/**
 * DSpace Thesis Metadata Fetcher
 * 
 * A tool to fetch thesis metadata from DSpace and export it to a JSON file.
 * Instead of directly manipulating the DOM, this version creates a data file
 * that can be used to update the website manually when needed.
 * 
 * Usage:
 * 1. Run this script in the browser console on the student-topics.html page
 * 2. Call ThesisMetadataExporter.exportData() to start the process
 * 3. Save the resulting JSON data to a file
 * 
 * @author Claude
 * @version 2.0.0
 */

class ThesisMetadataExporter {
  constructor(options = {}) {
    this.config = {
      dspaceBaseUrl: 'https://dspace.cvut.cz',
      throttleDelay: 500, // Delay between API calls to avoid rate limiting (ms)
      cardSelector: '.thesis-card',
      titleSelector: 'h4',
      studentSelector: '.student',
      ...options
    };

    this.dspaceApiUrl = `${this.config.dspaceBaseUrl}/rest/api`;
    this.thesisCards = document.querySelectorAll(this.config.cardSelector);
    this.processedCount = 0;
    this.totalCount = 0;
    this.metadataResults = {};
    this.cache = this.loadCache();
  }

  /**
   * Static method to initialize and start the export process
   */
  static exportData() {
    const exporter = new ThesisMetadataExporter();
    exporter.processAllTheses();
  }

  /**
   * Load cache from localStorage
   */
  loadCache() {
    try {
      const cacheData = localStorage.getItem('thesisMetadataCache');
      return cacheData ? JSON.parse(cacheData) : {};
    } catch (e) {
      console.error('Failed to load cache:', e);
      return {};
    }
  }

  /**
   * Save cache to localStorage
   */
  saveCache() {
    try {
      localStorage.setItem('thesisMetadataCache', JSON.stringify(this.cache));
    } catch (e) {
      console.error('Failed to save cache:', e);
    }
  }

  /**
   * Create a progress indicator
   */
  createProgressIndicator() {
    // Remove any existing progress indicator
    const existingIndicator = document.getElementById('thesis-exporter-progress');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    
    const progressContainer = document.createElement('div');
    progressContainer.id = 'thesis-exporter-progress';
    progressContainer.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: rgba(0, 102, 204, 0.9);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      z-index: 9999;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      transition: all 0.3s ease;
    `;
    
    progressContainer.innerHTML = `
      <div style="margin-bottom: 8px;">Fetching thesis metadata...</div>
      <div class="progress" style="height: 10px; background-color: rgba(255, 255, 255, 0.3); border-radius: 5px; overflow: hidden;">
        <div id="thesis-exporter-progress-bar" class="progress-bar" style="height: 100%; width: 0%; background-color: white; transition: width 0.3s ease;"></div>
      </div>
      <div id="thesis-exporter-progress-text" style="margin-top: 8px; text-align: center;">0/${this.totalCount}</div>
    `;
    
    document.body.appendChild(progressContainer);
  }

  /**
   * Update the progress indicator
   */
  updateProgress() {
    const progressBar = document.getElementById('thesis-exporter-progress-bar');
    const progressText = document.getElementById('thesis-exporter-progress-text');
    
    if (progressBar && progressText) {
      const percentage = (this.processedCount / this.totalCount) * 100;
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `${this.processedCount}/${this.totalCount}`;
    }
  }

  /**
   * Remove the progress indicator
   */
  removeProgressIndicator() {
    const progressContainer = document.getElementById('thesis-exporter-progress');
    if (progressContainer) {
      progressContainer.style.opacity = '0';
      setTimeout(() => {
        progressContainer.remove();
      }, 500);
    }
  }

  /**
   * Process all thesis cards and collect metadata
   */
  async processAllTheses() {
    console.log('Starting thesis metadata export process...');
    
    // Count total theses to process
    this.thesisCards.forEach(card => {
      const existingLink = card.querySelector('.thesis-link');
      if (existingLink) {
        // Extract handle ID from existing link
        const href = existingLink.getAttribute('href');
        const handleMatch = href.match(/handle\/([0-9/]+)/);
        if (handleMatch) {
          const handle = handleMatch[1];
          const title = card.querySelector(this.config.titleSelector).textContent.trim();
          this.cache[title] = {
            ...this.cache[title],
            handle,
            link: href
          };
        }
      }
      this.totalCount++;
    });

    // Create a progress indicator
    this.createProgressIndicator();
    
    // Process each thesis card
    for (const card of this.thesisCards) {
      await this.processThesisCard(card);
      
      // Update progress
      this.processedCount++;
      this.updateProgress();
      
      // Throttle API calls
      await new Promise(resolve => setTimeout(resolve, this.config.throttleDelay));
    }
    
    console.log('Thesis metadata export completed!');
    this.saveCache();
    this.displayResults();
    this.removeProgressIndicator();
  }
  
  /**
   * Process a single thesis card
   * @param {Element} card - The thesis card to process
   */
  async processThesisCard(card) {
    const title = card.querySelector(this.config.titleSelector).textContent.trim();
    const studentInfo = card.querySelector(this.config.studentSelector).textContent.trim();
    const studentName = studentInfo.split('|')[0].trim();
    const category = this.getThesisCategory(card);
    const type = this.getThesisType(card);
    const year = this.getThesisYear(card);
    
    // Basic metadata from the card
    let metadata = {
      title: title,
      student: studentName,
      type: type,
      category: category,
      year: year
    };
    
    // Check cache first
    if (this.cache[title] && this.cache[title].abstract) {
      metadata = { ...metadata, ...this.cache[title] };
      this.metadataResults[title] = metadata;
      return;
    }
    
    // If we have a handle but no abstract, fetch the abstract
    if (this.cache[title] && this.cache[title].handle) {
      try {
        const fetchedMetadata = await this.fetchFullMetadata(this.cache[title].handle);
        metadata = { ...metadata, ...this.cache[title], ...fetchedMetadata };
        this.cache[title] = { ...this.cache[title], ...fetchedMetadata };
        this.metadataResults[title] = metadata;
        return;
      } catch (error) {
        console.warn(`Failed to fetch metadata for ${title} using handle: ${error.message}`);
        // Fall back to search
      }
    }
    
    // Search for the thesis
    try {
      const searchResult = await this.searchThesis(title, studentName);
      if (searchResult) {
        metadata = { ...metadata, ...searchResult };
        this.cache[title] = { ...searchResult };
        this.metadataResults[title] = metadata;
      } else {
        // No results found, just store basic info
        this.metadataResults[title] = metadata;
      }
    } catch (error) {
      console.error(`Error processing ${title}:`, error);
      // Store whatever we have
      this.metadataResults[title] = metadata;
    }
  }
  
  /**
   * Extract the thesis category from its HTML element
   * @param {Element} card - The thesis card element
   * @returns {string} - The thesis category
   */
  getThesisCategory(card) {
    // Try to find category from data attribute
    const dataCategory = card.getAttribute('data-category');
    if (dataCategory) return dataCategory;
    
    // Try to find category from tags
    const tags = Array.from(card.querySelectorAll('.tag')).map(tag => tag.textContent.trim());
    if (tags.length > 0) {
      // Use the first tag as category
      return tags[0];
    }
    
    return 'unknown';
  }
  
  /**
   * Extract the thesis type (BT/MT) from its HTML element
   * @param {Element} card - The thesis card element
   * @returns {string} - The thesis type
   */
  getThesisType(card) {
    const typeElement = card.querySelector('.thesis-type');
    if (typeElement) return typeElement.textContent.trim();
    
    // Try to infer from other content
    const cardText = card.textContent.toLowerCase();
    if (cardText.includes('master') || cardText.includes('diploma') || 
        cardText.includes('mt') || cardText.includes('dp')) {
      return 'MT';
    } else if (cardText.includes('bachelor') || cardText.includes('bakalář') || 
               cardText.includes('bt') || cardText.includes('bp')) {
      return 'BT';
    }
    
    return 'unknown';
  }
  
  /**
   * Extract the thesis year from its container
   * @param {Element} card - The thesis card element
   * @returns {string} - The thesis year
   */
  getThesisYear(card) {
    const yearSection = card.closest('.timeline-year');
    if (yearSection) {
      const yearHeading = yearSection.querySelector('.year-heading');
      if (yearHeading) return yearHeading.textContent.trim();
    }
    
    return 'unknown';
  }

  /**
   * Search for a thesis in DSpace
   * @param {string} title - The thesis title
   * @param {string} author - The author name
   * @returns {Object|null} - The thesis metadata or null if not found
   */
  async searchThesis(title, author) {
    console.log(`Searching for thesis: "${title}" by ${author}`);
    
    const searchQuery = `${title} ${author} Kordík`;
    const searchUrl = `${this.dspaceApiUrl}/discover/search/objects?query=${encodeURIComponent(searchQuery)}&dsoType=item&scope=&configuration=default`;
    
    try {
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data._embedded?.searchResult?._embedded?.objects?.length > 0) {
        // Get the first result
        const firstResult = data._embedded.searchResult._embedded.objects[0];
        const handle = firstResult._embedded.indexableObject.handle;
        const directLink = `${this.config.dspaceBaseUrl}/handle/${handle}`;
        
        // Fetch full metadata
        const metadata = await this.fetchFullMetadata(handle);
        
        return {
          handle,
          link: directLink,
          ...metadata
        };
      }
      
      console.warn(`No results found for thesis: "${title}"`);
      return null;
    } catch (error) {
      console.error(`Error searching for thesis: "${title}"`, error);
      return null;
    }
  }

  /**
   * Fetch metadata from the DSpace REST API
   * @param {string} handle - The handle ID of the thesis
   * @returns {Object} - The thesis metadata
   */
  async fetchFullMetadata(handle) {
    const itemUrl = `${this.dspaceApiUrl}/core/items/${handle.replace('/', '%2F')}`;
    
    try {
      const response = await fetch(itemUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Extract metadata
      const metadata = {
        abstract: this.extractMetadataValue(data, 'dc.description.abstract'),
        abstractEn: this.extractMetadataValue(data, 'dc.description.abstract', 'eng'),
        abstractCz: this.extractMetadataValue(data, 'dc.description.abstract', 'cze'),
        keywords: this.extractMetadataValues(data, 'dc.subject'),
        dateIssued: this.extractMetadataValue(data, 'dc.date.issued'),
        language: this.extractMetadataValue(data, 'dc.language.iso'),
        docType: this.extractMetadataValue(data, 'dc.type'),
        pdfLink: null  // Will be fetched in a separate step
      };
      
      // Try to get the direct PDF link and other bitstreams
      try {
        const bitstreamUrl = `${this.dspaceApiUrl}/core/items/${handle.replace('/', '%2F')}/bitstreams`;
        const bitstreamResponse = await fetch(bitstreamUrl);
        const bitstreamData = await bitstreamResponse.json();
        
        if (bitstreamData._embedded?.bitstreams?.length > 0) {
          // Find the main PDF file
          const pdfBitstream = bitstreamData._embedded.bitstreams.find(b => 
            b.name.toLowerCase().endsWith('.pdf') && 
            !b.name.toLowerCase().includes('posudek')
          );
          
          if (pdfBitstream) {
            metadata.pdfLink = `${this.config.dspaceBaseUrl}/bitstream/handle/${handle}/${pdfBitstream.name}?sequence=-1&isAllowed=y`;
          }
          
          // Find reviews/evaluations
          const reviewBitstreams = bitstreamData._embedded.bitstreams.filter(b => 
            b.name.toLowerCase().includes('posudek')
          );
          
          if (reviewBitstreams.length > 0) {
            metadata.reviews = reviewBitstreams.map(b => ({
              name: b.name,
              link: `${this.config.dspaceBaseUrl}/bitstream/handle/${handle}/${b.name}?sequence=-1&isAllowed=y`
            }));
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch bitstreams for handle ${handle}:`, error);
      }
      
      // Fallback to page scraping if API fails to provide PDF links
      if (!metadata.pdfLink) {
        try {
          const pageUrl = `${this.config.dspaceBaseUrl}/handle/${handle}`;
          const pageResponse = await fetch(pageUrl);
          const pageHtml = await pageResponse.text();
          
          // Create a DOM parser
          const parser = new DOMParser();
          const doc = parser.parseFromString(pageHtml, 'text/html');
          
          // Find PDF links
          const pdfLinks = Array.from(doc.querySelectorAll('a[href*=".pdf"]'));
          
          if (pdfLinks.length > 0) {
            // Find the main PDF (usually the one not containing "posudek")
            const mainPdfLink = pdfLinks.find(link => 
              !link.textContent.toLowerCase().includes('posudek')
            );
            
            if (mainPdfLink) {
              metadata.pdfLink = new URL(mainPdfLink.href, pageUrl).href;
            }
            
            // Find reviews
            const reviewLinks = pdfLinks.filter(link => 
              link.textContent.toLowerCase().includes('posudek')
            );
            
            if (reviewLinks.length > 0 && !metadata.reviews) {
              metadata.reviews = reviewLinks.map(link => ({
                name: link.textContent,
                link: new URL(link.href, pageUrl).href
              }));
            }
          }
        } catch (error) {
          console.warn(`Failed to scrape page for handle ${handle}:`, error);
        }
      }
      
      return metadata;
    } catch (error) {
      console.error(`Error fetching metadata for handle ${handle}:`, error);
      return {
        abstract: 'Abstract not available',
        keywords: []
      };
    }
  }

  /**
   * Extract a single metadata value from DSpace item data
   * @param {Object} data - The DSpace item data
   * @param {string} key - The metadata key to extract
   * @param {string} lang - Optional language filter
   * @returns {string} - The metadata value or null if not found
   */
  extractMetadataValue(data, key, lang = null) {
    let metadataFields = data.metadata?.filter(meta => meta.key === key);
    
    if (lang) {
      metadataFields = metadataFields.filter(meta => meta.language === lang);
    }
    
    return metadataFields?.[0]?.value || null;
  }

  /**
   * Extract multiple metadata values from DSpace item data
   * @param {Object} data - The DSpace item data
   * @param {string} key - The metadata key to extract
   * @returns {Array} - Array of metadata values
   */
  extractMetadataValues(data, key) {
    return data.metadata?.filter(meta => meta.key === key)
      .map(meta => meta.value) || [];
  }

  /**
   * Display the results and provide download options
   */
  displayResults() {
    // Create a modal to display the results
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background-color: white;
      padding: 20px;
      border-radius: 5px;
      max-width: 800px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    `;
    
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      border: none;
      background: none;
      font-size: 24px;
      cursor: pointer;
      color: #333;
    `;
    closeButton.addEventListener('click', () => modal.remove());
    
    const title = document.createElement('h2');
    title.textContent = 'Thesis Metadata Export';
    title.style.marginTop = '0';
    
    const summary = document.createElement('p');
    summary.textContent = `Successfully fetched metadata for ${Object.keys(this.metadataResults).length} theses.`;
    
    const downloadButton = document.createElement('button');
    downloadButton.textContent = 'Download JSON';
    downloadButton.className = 'btn btn-primary';
    downloadButton.style.marginRight = '10px';
    downloadButton.addEventListener('click', () => this.downloadJSON());
    
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy to Clipboard';
    copyButton.className = 'btn btn-secondary';
    copyButton.style.marginRight = '10px';
    copyButton.addEventListener('click', () => {
      const jsonStr = JSON.stringify(this.metadataResults, null, 2);
      navigator.clipboard.writeText(jsonStr)
        .then(() => {
          copyButton.textContent = 'Copied!';
          setTimeout(() => {
            copyButton.textContent = 'Copy to Clipboard';
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy: ', err);
          copyButton.textContent = 'Failed to copy';
        });
    });
    
    const previewButton = document.createElement('button');
    previewButton.textContent = 'Preview Data';
    previewButton.className = 'btn btn-info';
    previewButton.addEventListener('click', () => {
      const previewArea = document.getElementById('preview-area');
      if (previewArea.style.display === 'none') {
        previewArea.style.display = 'block';
        previewButton.textContent = 'Hide Preview';
      } else {
        previewArea.style.display = 'none';
        previewButton.textContent = 'Preview Data';
      }
    });
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginBottom = '20px';
    buttonContainer.appendChild(downloadButton);
    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(previewButton);
    
    const previewArea = document.createElement('pre');
    previewArea.id = 'preview-area';
    previewArea.style.cssText = `
      background-color: #f5f5f5;
      padding: 10px;
      border-radius: 4px;
      max-height: 400px;
      overflow-y: auto;
      display: none;
      white-space: pre-wrap;
      word-break: break-all;
    `;
    previewArea.textContent = JSON.stringify(this.metadataResults, null, 2);
    
    modalContent.appendChild(closeButton);
    modalContent.appendChild(title);
    modalContent.appendChild(summary);
    modalContent.appendChild(buttonContainer);
    modalContent.appendChild(previewArea);
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
  }
  
  /**
   * Download the metadata as a JSON file
   */
  downloadJSON() {
    const jsonStr = JSON.stringify(this.metadataResults, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'thesis-metadata.json';
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }
}

// Instructions to use in browser console:
console.log('Thesis Metadata Exporter loaded!');
console.log('To start exporting thesis metadata, run:');
console.log('ThesisMetadataExporter.exportData()');

// Export the exporter for global access
window.ThesisMetadataExporter = ThesisMetadataExporter; 
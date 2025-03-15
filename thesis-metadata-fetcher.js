/**
 * DSpace Thesis Metadata Fetcher
 * 
 * A standalone script to enhance thesis cards by fetching metadata from DSpace.
 * This script fetches abstracts, direct links, and additional metadata for theses
 * listed on a page, enriching the user experience with more detailed information.
 * 
 * Usage:
 * 1. Include this script in your HTML: <script src="thesis-metadata-fetcher.js"></script>
 * 2. Call ThesisEnhancer.initialize() to add a button to the page
 * 3. Or create a new ThesisEnhancer instance and call enhance() directly
 * 
 * @author Claude
 * @version 1.0.0
 */

class ThesisEnhancer {
  constructor(options = {}) {
    this.config = {
      dspaceBaseUrl: 'https://dspace.cvut.cz',
      throttleDelay: 500, // Delay between API calls to avoid rate limiting (ms)
      cacheTTL: 7 * 24 * 60 * 60 * 1000, // Cache TTL: 1 week in milliseconds
      cardSelector: '.thesis-card',
      titleSelector: 'h4',
      studentSelector: '.student',
      buttonText: 'Load Thesis Abstracts & Links',
      buttonLoadingText: 'Loading Thesis Data...',
      buttonRefreshText: 'Refresh Thesis Data',
      ...options
    };

    this.dspaceApiUrl = `${this.config.dspaceBaseUrl}/rest/api`;
    this.thesisCards = document.querySelectorAll(this.config.cardSelector);
    this.processedCount = 0;
    this.totalCount = 0;
    this.cache = this.loadCache();
  }

  /**
   * Initialize the enhancer by adding a button to the page
   * @param {string} containerSelector - CSS selector for the container to add the button to
   */
  static initialize(containerSelector = '#past-theses') {
    document.addEventListener('DOMContentLoaded', () => {
      const enhancer = new ThesisEnhancer();
      enhancer.addControlButton(containerSelector);
    });
  }

  /**
   * Add a control button to the specified container
   * @param {string} containerSelector - CSS selector for the container to add the button to
   */
  addControlButton(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const controlButton = document.createElement('button');
    controlButton.id = 'enhance-theses-button';
    controlButton.className = 'btn btn-outline-primary';
    controlButton.style.cssText = 'margin-top: 20px; display: block; margin-left: auto; margin-right: auto;';
    controlButton.textContent = this.config.buttonText;
    
    // Add button after the filter tabs
    const tabsContent = container.querySelector('.tab-content');
    if (tabsContent) {
      tabsContent.parentNode.insertBefore(controlButton, tabsContent.nextSibling);
    } else {
      container.appendChild(controlButton);
    }
    
    // Add event listener
    controlButton.addEventListener('click', () => {
      this.enhance();
      controlButton.disabled = true;
      controlButton.textContent = this.config.buttonLoadingText;
      
      // Re-enable button after completion
      setTimeout(() => {
        controlButton.disabled = false;
        controlButton.textContent = this.config.buttonRefreshText;
      }, this.totalCount * this.config.throttleDelay + 1000);
    });
  }

  /**
   * Load the cache from localStorage
   * @returns {Object} The cached data or an empty object
   */
  loadCache() {
    try {
      const cacheData = localStorage.getItem('thesisMetadataCache');
      if (!cacheData) return {};
      
      const cache = JSON.parse(cacheData);
      
      // Check if cache has expired entries and clean them
      const now = Date.now();
      let hasChanges = false;
      
      Object.keys(cache).forEach(key => {
        if (cache[key].timestamp && (now - cache[key].timestamp) > this.config.cacheTTL) {
          delete cache[key];
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        localStorage.setItem('thesisMetadataCache', JSON.stringify(cache));
      }
      
      return cache;
    } catch (e) {
      console.error('Failed to load cache:', e);
      return {};
    }
  }

  /**
   * Save the cache to localStorage
   */
  saveCache() {
    try {
      localStorage.setItem('thesisMetadataCache', JSON.stringify(this.cache));
    } catch (e) {
      console.error('Failed to save cache:', e);
    }
  }

  /**
   * Main method to enhance thesis cards with metadata
   */
  async enhance() {
    console.log('Starting thesis enhancement process...');
    
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
            link: href,
            timestamp: Date.now()
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
    
    console.log('Thesis enhancement completed!');
    this.saveCache();
    this.removeProgressIndicator();
  }

  /**
   * Create a progress indicator
   */
  createProgressIndicator() {
    const progressContainer = document.createElement('div');
    progressContainer.id = 'thesis-enhancer-progress';
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
      <div style="margin-bottom: 8px;">Enhancing thesis information...</div>
      <div class="progress" style="height: 10px; background-color: rgba(255, 255, 255, 0.3); border-radius: 5px; overflow: hidden;">
        <div id="thesis-enhancer-progress-bar" class="progress-bar" style="height: 100%; width: 0%; background-color: white; transition: width 0.3s ease;"></div>
      </div>
      <div id="thesis-enhancer-progress-text" style="margin-top: 8px; text-align: center;">0/${this.totalCount}</div>
    `;
    
    document.body.appendChild(progressContainer);
  }

  /**
   * Update the progress indicator
   */
  updateProgress() {
    const progressBar = document.getElementById('thesis-enhancer-progress-bar');
    const progressText = document.getElementById('thesis-enhancer-progress-text');
    
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
    const progressContainer = document.getElementById('thesis-enhancer-progress');
    if (progressContainer) {
      progressContainer.style.opacity = '0';
      setTimeout(() => {
        progressContainer.remove();
      }, 500);
    }
  }

  /**
   * Process a single thesis card
   * @param {Element} card - The thesis card element to process
   */
  async processThesisCard(card) {
    const title = card.querySelector(this.config.titleSelector).textContent.trim();
    const studentInfo = card.querySelector(this.config.studentSelector).textContent.trim();
    const studentName = studentInfo.split('|')[0].trim();
    
    // Skip if the card already has detailed content
    if (card.querySelector('.thesis-abstract')) {
      console.log(`Skipping ${title} - already enhanced`);
      return;
    }
    
    // Check cache first
    if (this.cache[title] && this.cache[title].abstract) {
      this.updateThesisCard(card, this.cache[title]);
      return;
    }
    
    // If we have a handle but no abstract, just fetch the abstract
    if (this.cache[title] && this.cache[title].handle) {
      try {
        const metadata = await this.fetchFullMetadata(this.cache[title].handle);
        this.cache[title] = {
          ...this.cache[title],
          ...metadata,
          timestamp: Date.now()
        };
        this.updateThesisCard(card, this.cache[title]);
        return;
      } catch (error) {
        console.warn(`Failed to fetch metadata for ${title} using handle: ${error.message}`);
        // Fall back to search
      }
    }
    
    // Otherwise, search for the thesis
    try {
      const searchResult = await this.searchThesis(title, studentName);
      if (searchResult) {
        this.cache[title] = {
          ...searchResult,
          timestamp: Date.now()
        };
        this.updateThesisCard(card, searchResult);
      }
    } catch (error) {
      console.error(`Error processing ${title}:`, error);
    }
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
        keywords: this.extractMetadataValues(data, 'dc.subject'),
        dateIssued: this.extractMetadataValue(data, 'dc.date.issued'),
        language: this.extractMetadataValue(data, 'dc.language.iso'),
        type: this.extractMetadataValue(data, 'dc.type'),
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
   * @returns {string} - The metadata value or null if not found
   */
  extractMetadataValue(data, key) {
    const metadataField = data.metadata?.find(meta => meta.key === key);
    return metadataField?.value || null;
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
   * Update a thesis card with fetched metadata
   * @param {Element} card - The thesis card element to update
   * @param {Object} metadata - The thesis metadata
   */
  updateThesisCard(card, metadata) {
    // Don't update if already updated
    if (card.querySelector('.thesis-abstract')) {
      return;
    }
    
    // Create enhanced card content
    const enhancedContent = document.createElement('div');
    enhancedContent.className = 'thesis-enhanced-content';
    
    // Add abstract if available
    if (metadata.abstract) {
      const abstractSection = this.createAbstractSection(metadata.abstract);
      enhancedContent.appendChild(abstractSection);
    }
    
    // Add keywords if available
    if (metadata.keywords && metadata.keywords.length > 0) {
      const keywordsSection = this.createKeywordsSection(metadata.keywords);
      enhancedContent.appendChild(keywordsSection);
    }
    
    // Create links section
    const linksSection = document.createElement('div');
    linksSection.className = 'thesis-links';
    linksSection.style.marginTop = '15px';
    
    // Add repository link
    if (metadata.link) {
      const repoLink = document.createElement('a');
      repoLink.className = 'thesis-link mr-2';
      repoLink.href = metadata.link;
      repoLink.target = '_blank';
      repoLink.innerHTML = '<i class="bi bi-archive"></i> Repository page';
      repoLink.style.marginRight = '10px';
      linksSection.appendChild(repoLink);
    }
    
    // Add PDF link if available
    if (metadata.pdfLink) {
      const pdfLink = document.createElement('a');
      pdfLink.className = 'thesis-link mr-2';
      pdfLink.href = metadata.pdfLink;
      pdfLink.target = '_blank';
      pdfLink.innerHTML = '<i class="bi bi-file-earmark-text"></i> Full text PDF';
      pdfLink.style.marginRight = '10px';
      linksSection.appendChild(pdfLink);
    }
    
    // Add reviews if available
    if (metadata.reviews && metadata.reviews.length > 0) {
      const reviewsDropdown = this.createReviewsDropdown(metadata.reviews);
      linksSection.appendChild(reviewsDropdown);
    }
    
    enhancedContent.appendChild(linksSection);
    
    // Add metadata badge
    if (metadata.dateIssued || metadata.type) {
      const metaBadge = document.createElement('div');
      metaBadge.className = 'thesis-meta-badge';
      metaBadge.style.cssText = `
        margin-top: 10px;
        font-size: 12px;
        color: #6c757d;
      `;
      
      if (metadata.type) {
        metaBadge.innerHTML += `<span>${metadata.type}</span>`;
      }
      
      if (metadata.dateIssued) {
        if (metadata.type) metaBadge.innerHTML += ' · ';
        metaBadge.innerHTML += `<span>Published: ${metadata.dateIssued}</span>`;
      }
      
      enhancedContent.appendChild(metaBadge);
    }
    
    // Find insertion point and add the enhanced content
    const studentInfo = card.querySelector('.student');
    if (studentInfo) {
      studentInfo.parentNode.insertBefore(enhancedContent, studentInfo.nextSibling);
    } else {
      card.appendChild(enhancedContent);
    }
    
    // Remove original thesis link if it exists (to avoid duplication)
    const originalLink = card.querySelector('.thesis-link:not(.mr-2)');
    if (originalLink && originalLink.parentElement) {
      if (originalLink.parentElement.childElementCount === 1) {
        originalLink.parentElement.remove(); // Remove parent if it only contains the link
      } else {
        originalLink.remove(); // Just remove the link
      }
    }
    
    // Add visual indicator that the card has been enhanced
    card.classList.add('thesis-enhanced');
    card.style.transition = 'all 0.3s ease';
    
    // Briefly highlight the card to show it's been updated
    const originalBackground = card.style.backgroundColor;
    card.style.backgroundColor = 'rgba(0, 102, 204, 0.1)';
    setTimeout(() => {
      card.style.backgroundColor = originalBackground;
    }, 1000);
  }

  /**
   * Create an abstract section for the thesis card
   * @param {string} abstract - The thesis abstract
   * @returns {Element} - The abstract section element
   */
  createAbstractSection(abstract) {
    const abstractSection = document.createElement('div');
    abstractSection.className = 'thesis-abstract';
    abstractSection.style.cssText = `
      margin-top: 15px;
      font-size: 14px;
      color: #6c757d;
      position: relative;
      overflow: hidden;
      max-height: 100px;
      transition: max-height 0.3s ease;
    `;
    
    const abstractText = document.createElement('p');
    abstractText.textContent = abstract || 'Abstract not available';
    abstractSection.appendChild(abstractText);
    
    // Add "Read more" toggle if abstract is long
    if ((abstract?.length || 0) > 200) {
      const gradient = document.createElement('div');
      gradient.className = 'abstract-gradient';
      gradient.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 40px;
        background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,1));
        pointer-events: none;
      `;
      
      const readMore = document.createElement('button');
      readMore.className = 'btn btn-sm btn-link abstract-toggle p-0';
      readMore.textContent = 'Read more';
      readMore.style.cssText = `
        display: block;
        margin-top: 5px;
        font-size: 12px;
        text-decoration: none;
      `;
      
      abstractSection.appendChild(gradient);
      abstractSection.appendChild(readMore);
      
      readMore.addEventListener('click', function() {
        if (abstractSection.style.maxHeight === '100px') {
          abstractSection.style.maxHeight = '1000px';
          gradient.style.display = 'none';
          readMore.textContent = 'Show less';
        } else {
          abstractSection.style.maxHeight = '100px';
          gradient.style.display = 'block';
          readMore.textContent = 'Read more';
        }
      });
    }
    
    return abstractSection;
  }

  /**
   * Create a keywords section for the thesis card
   * @param {Array} keywords - The thesis keywords
   * @returns {Element} - The keywords section element
   */
  createKeywordsSection(keywords) {
    const keywordsSection = document.createElement('div');
    keywordsSection.className = 'thesis-keywords';
    keywordsSection.style.cssText = `
      margin-top: 10px;
    `;
    
    // Define a set of background colors for the tags
    const tagColors = [
      'bg-primary',
      'bg-info',
      'bg-secondary',
      'bg-success',
      'bg-warning'
    ];
    
    keywords.forEach((keyword, index) => {
      const tag = document.createElement('span');
      tag.className = `tag ${tagColors[index % tagColors.length]}`;
      tag.textContent = keyword;
      keywordsSection.appendChild(tag);
    });
    
    return keywordsSection;
  }

  /**
   * Create a dropdown for thesis reviews
   * @param {Array} reviews - The thesis reviews
   * @returns {Element} - The reviews dropdown element
   */
  createReviewsDropdown(reviews) {
    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'dropdown d-inline-block';
    dropdownContainer.style.marginRight = '10px';
    
    const dropdownButton = document.createElement('button');
    dropdownButton.className = 'btn btn-sm btn-outline-secondary dropdown-toggle';
    dropdownButton.type = 'button';
    dropdownButton.setAttribute('data-bs-toggle', 'dropdown');
    dropdownButton.setAttribute('aria-expanded', 'false');
    dropdownButton.innerHTML = '<i class="bi bi-file-earmark-text"></i> Reviews';
    
    const dropdownMenu = document.createElement('ul');
    dropdownMenu.className = 'dropdown-menu';
    
    reviews.forEach(review => {
      const menuItem = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'dropdown-item';
      link.href = review.link;
      link.target = '_blank';
      link.textContent = review.name.replace(/\.pdf$/i, '');
      menuItem.appendChild(link);
      dropdownMenu.appendChild(menuItem);
    });
    
    dropdownContainer.appendChild(dropdownButton);
    dropdownContainer.appendChild(dropdownMenu);
    
    return dropdownContainer;
  }
}

// Export the enhancer for global access
window.ThesisEnhancer = ThesisEnhancer;

// Initialize when included directly
if (typeof document !== 'undefined') {
  ThesisEnhancer.initialize();
} 
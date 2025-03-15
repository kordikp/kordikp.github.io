# Pavel Kordík - Personal Website

This repository contains the source code for my personal website, available at [kordikp.github.io](https://kordikp.github.io).

## About

A minimalist personal website showcasing my work as:
- CEO at Recombee
- AI Researcher
- Academic Leader at CTU

## Local Development

To run this website locally:
1. Clone the repository
2. Open `index.html` in your browser

## Contact

For any questions or suggestions about this website, please reach out through the contact information provided on the site.

# Personal Profile Website

## Overview
This repository contains the code for a personal professional website showcasing academic and industry achievements, publications, and projects.

## Features
- Responsive design that works across devices
- Timeline of professional milestones
- Publication listings with citation counts
- Project showcase
- Contact information

## Updating the Website

### Updating Citation Counts
The website includes a feature to display citation counts for publications. Since Google Scholar doesn't provide a public API, citation counts need to be updated manually.

To update citation counts:

1. **Get citation data from Google Scholar**
   - Visit [Google Scholar](https://scholar.google.com/) and search for the publications
   - Note the citation count for each publication

2. **Update using the browser console**
   - Open the `update-citations.js` file
   - Update the citation counts in the `citationData` object
   - Copy the generated `updateCitationCounts()` function call
   - Open the website in a browser
   - Open the browser's developer console (F12 or Right-click > Inspect > Console)
   - Paste and execute the function call
   
3. **Permanent updates**
   - For permanent updates, modify the citation badge numbers directly in the HTML
   - Update the `<span class="badge bg-primary">XX+ citations</span>` elements

### Adding New Publications
To add new publications:

1. Edit the `index.html` file
2. Locate the publications section
3. Add a new paper entry following the existing format
4. Include the data-citation-id attribute to enable automatic citation updates

Example:
```html
<div class="paper">
  <strong data-citation-id="uniqueID">Paper Title</strong>
  <p class="authors">Author1, A., & Author2, B.</p>
  <p class="venue">Journal Name (Year)</p>
  <p class="description">Brief description of the paper.</p>
  <button class="btn btn-sm btn-outline-primary copy-citation" data-citation="@article{...}">Copy Citation</button>
</div>
```

## Timeline Management
To update the timeline:

1. Edit the `index.html` file
2. Find the timeline section
3. Add new entries following the existing pattern, alternating between `.timeline` and `.timeline-inverted` classes
4. Use appropriate badge icons (academic or industry) 
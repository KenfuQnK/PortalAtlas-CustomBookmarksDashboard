// Function to initialize the script
async function initNavigation() {
    await updateNavigationMenu();
    
    // Mutation observer to update the menu when content changes
    const mainContainer = document.getElementById('main-container');
    const observer = new MutationObserver(updateNavigationMenu);
    observer.observe(mainContainer, { childList: true, subtree: true });

    // Add scroll event to update the active section
    mainContainer.addEventListener('scroll', updateActiveSection);
}

// Function to update the list of sections in the navigation menu
async function updateNavigationMenu() {
    const navigationContainer = document.getElementById('navigation-container');
    const wrappers = await dataManager.getAllWrappers();
    
    // Create an unordered list
    const ul = document.getElementById('nav-list');
    ul.innerHTML = '';
    
    wrappers.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(wrapper => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = wrapper.name;
        a.href = '#' + wrapper.id;
        
        a.addEventListener('click', function(e) {
            e.preventDefault();
            scrollToSection(wrapper.id);
            expandSection(wrapper.id);
        });
        
        li.appendChild(a);
        ul.appendChild(li);
    });
}

// Function to scroll to a specific section
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    section.scrollIntoView({ behavior: 'smooth' });
}

// Update the navigation menu after rendering the wrappers
const originalRenderWrappers = renderWrappers;
renderWrappers = async function() {
    await originalRenderWrappers();
    await updateNavigationMenu();
    updateActiveSection();
};

// Function to expand a section and collapse others
function expandSection(sectionId) {
    const wrappers = document.querySelectorAll('.wrapper');
    wrappers.forEach(wrapper => {
        const sectionContent = wrapper.querySelector('.section-content');
        const icon = wrapper.querySelector('.toggle-icon');
        
        if (wrapper.id === sectionId) {
            sectionContent.classList.add('show');
            icon.classList.remove('collapsed');
            
            // Ensure content is loaded before getting the height
            setTimeout(() => {
                const totalHeight = Array.from(sectionContent.children)
                    .reduce((height, child) => height + child.offsetHeight, 0);
                sectionContent.style.maxHeight = `${totalHeight}px`;
            }, 0);
        } else {
            sectionContent.classList.remove('show');
            icon.classList.add('collapsed');
            sectionContent.style.maxHeight = null;
        }
    });
    
    saveWrapperStates();
}

// Function to update the highlight in the navigation menu
function updateActiveSection() {
    const mainContainer = document.getElementById('main-container');
    const scrollPosition = mainContainer.scrollTop + 20;
    const wrappers = document.querySelectorAll('.wrapper');
    const navLinks = document.querySelectorAll('#navigation-container a');

    wrappers.forEach((wrapper, index) => {
        const wrapperTop = wrapper.offsetTop;
        const wrapperHeight = wrapper.offsetHeight;

        if (scrollPosition >= wrapperTop && scrollPosition < wrapperTop + wrapperHeight) {
            navLinks.forEach(link => link.classList.remove('active'));
            navLinks[index].classList.add('active');
        }
    });
}
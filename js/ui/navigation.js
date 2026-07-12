// Function to initialize the script
async function initNavigation() {
    setupNavigationResize();
    document.getElementById('expand-all-sections').addEventListener('click', () => setAllSectionsExpanded(true));
    document.getElementById('collapse-all-sections').addEventListener('click', () => setAllSectionsExpanded(false));
    await updateNavigationMenu();
    const mainContainer = document.getElementById('main-container');
    let scrollFrame = null;
    mainContainer.addEventListener('scroll', () => {
        if (scrollFrame !== null) return;
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = null;
            updateActiveSection();
        });
    }, { passive: true });
}

const NAVIGATION_WIDTH_KEY = 'portalAtlas.navigationWidth';
const NAVIGATION_MIN_WIDTH = 150;
const NAVIGATION_MAX_WIDTH = 520;

function clampNavigationWidth(width) {
    return Math.min(NAVIGATION_MAX_WIDTH, Math.max(NAVIGATION_MIN_WIDTH, width));
}

function applyNavigationWidth(width) {
    const availableWidth = Math.max(NAVIGATION_MIN_WIDTH, window.innerWidth - 320);
    const safeWidth = Math.min(clampNavigationWidth(width), availableWidth);
    document.body.style.setProperty('--navigation-width', `${safeWidth}px`);
    return safeWidth;
}

function setupNavigationResize() {
    const resizer = document.getElementById('navigation-resizer');
    const storedWidth = Number.parseFloat(localStorage.getItem(NAVIGATION_WIDTH_KEY));
    let preferredWidth = Number.isFinite(storedWidth)
        ? storedWidth
        : document.getElementById('navigation-container').getBoundingClientRect().width;
    applyNavigationWidth(preferredWidth);

    let activePointerId = null;
    let dragOffset = 0;
    resizer.addEventListener('pointerdown', event => {
        activePointerId = event.pointerId;
        dragOffset = event.clientX
            - document.getElementById('navigation-container').getBoundingClientRect().width;
        resizer.setPointerCapture(event.pointerId);
        document.body.classList.add('is-resizing-navigation');
        event.preventDefault();
    });

    resizer.addEventListener('pointermove', event => {
        if (event.pointerId !== activePointerId) return;
        preferredWidth = event.clientX - dragOffset;
        applyNavigationWidth(preferredWidth);
    });

    const finishResize = event => {
        if (event.pointerId !== activePointerId) return;
        activePointerId = null;
        document.body.classList.remove('is-resizing-navigation');
        const currentWidth = document.getElementById('navigation-container').getBoundingClientRect().width;
        preferredWidth = currentWidth;
        localStorage.setItem(NAVIGATION_WIDTH_KEY, String(Math.round(currentWidth)));
    };
    resizer.addEventListener('pointerup', finishResize);
    resizer.addEventListener('pointercancel', finishResize);

    resizer.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const currentWidth = document.getElementById('navigation-container').getBoundingClientRect().width;
        preferredWidth = currentWidth + direction * 16;
        const nextWidth = applyNavigationWidth(preferredWidth);
        preferredWidth = nextWidth;
        localStorage.setItem(NAVIGATION_WIDTH_KEY, String(Math.round(nextWidth)));
        event.preventDefault();
    });

    window.addEventListener('resize', () => {
        applyNavigationWidth(preferredWidth);
    });
}

function setAllSectionsExpanded(expanded) {
    document.querySelectorAll('.wrapper').forEach(wrapper => setSectionExpanded(wrapper, expanded));
    saveWrapperStates();
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
    section?.scrollIntoView({ behavior: 'smooth' });
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
    wrappers.forEach(wrapper => setSectionExpanded(wrapper, wrapper.id === sectionId));
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
            navLinks[index]?.classList.add('active');
        }
    });
}

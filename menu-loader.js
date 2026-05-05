document.addEventListener("DOMContentLoaded", () => {
    fetch("menu.html")
        .then(response => response.text())
        .then(data => {
            document.getElementById("menu-placeholder").innerHTML = data;
            
            // 1. Initialize icons for the injected menu (safeguard)
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }

            // 2. Active Link Highlighting logic
            const currentPath = window.location.pathname.split("/").pop() || "index.html";
            const navLinks = document.querySelectorAll(".nav-link");
            
            navLinks.forEach(link => {
                const href = link.getAttribute("href");
                if (href === currentPath) {
                    // Make it active using your tailwind config accent colour
                    link.classList.add("text-brand-accent");
                    link.classList.remove("text-gray-600", "text-gray-700", "text-gray-800");
                }
            });

            // 3. Re-initialize Mobile Menu Logic (Updated to toggle SVG classes)
            const mobileMenuBtn = document.getElementById('mobile-menu-btn');
            const mobileMenu = document.getElementById('mobile-menu');
            const iconBars = document.getElementById('menu-icon-bars');
            const iconClose = document.getElementById('menu-icon-close');
            let isMenuOpen = false;

            function toggleMenu() {
                isMenuOpen = !isMenuOpen;
                if(isMenuOpen) {
                    mobileMenu.classList.remove('hidden');
                    if(iconBars) iconBars.classList.add('hidden');
                    if(iconClose) iconClose.classList.remove('hidden');
                } else {
                    mobileMenu.classList.add('hidden');
                    if(iconBars) iconBars.classList.remove('hidden');
                    if(iconClose) iconClose.classList.add('hidden');
                }
            }

            if(mobileMenuBtn) {
                mobileMenuBtn.addEventListener('click', toggleMenu);
            }
        })
        .catch(error => console.error("Error loading menu:", error));
});

// Global Navbar Scroll Logic (applies to all pages)
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (navbar) {
        if (window.scrollY > 20) {
            navbar.classList.add('shadow-md');
        } else {
            navbar.classList.remove('shadow-md');
        }
    }
});
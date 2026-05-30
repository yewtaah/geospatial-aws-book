// Smooth scroll navigation
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// Author photo lightbox
const lightboxCaptions = {
    ScottBateman: `Before there were smart screens, “blue dots,” or ChatGPT, I was a curious kid in Salt Lake City deconstructing the geography of Utah to prove a point. In the ‘90s, I spent my lunch breaks manually digitizing temperature data from the Salt Lake Tribune and plugging it into Microsoft Access to build a scrolling digital map. It was probably the most inefficient “GIS” ever created—and I’ve been obsessed with optimizing how we visualize the world ever since.`
};

function openLightbox(src, name) {
    const lb = document.getElementById('lightbox');
    document.getElementById('lightbox-img').src = src;
    document.getElementById('lightbox-img').alt = name;
    document.getElementById('lightbox-caption').textContent = lightboxCaptions[name] || name;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
    document.body.style.overflow = '';
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeLightbox();
});

// Navbar scroll shadow
const navbar = document.querySelector('.navbar');
window.addEventListener('scroll', function () {
    if (window.pageYOffset > 50) {
        navbar.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.5)';
    } else {
        navbar.style.boxShadow = 'none';
    }
});

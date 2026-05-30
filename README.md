# Geospatial Data Analytics on AWS

A website promoting the book "Geospatial Data Analytics on AWS" with interactive playgrounds and code examples.

## About

This is the official companion website for the Packt book on geospatial data analytics using Amazon Web Services. The site includes:

- Book information and purchase links
- Interactive playgrounds and prototypes
- Code examples and resources
- Links to AWS geospatial services

## Getting Started

### Prerequisites
- A web browser
- Git (for version control)
- A text editor (VS Code recommended)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/yewtaah/geospatial-aws-book.git
cd geospatial-aws-book
```

2. Open `index.html` in your browser or use a local web server:
```bash
# Using Python 3
python -m http.server 8000

# Using Node.js/http-server
npx http-server
```

3. Visit `http://localhost:8000` in your browser

## Project Structure

```
geospatial-aws-book/
├── index.html          # Main landing page
├── css/
│   └── style.css      # Main stylesheet
├── js/
│   └── main.js        # Client-side JavaScript
├── assets/            # Images and static files
├── playgrounds/       # Interactive playground pages
└── README.md          # This file
```

## Pages

- **index.html** - Main landing page with book overview
- **playgrounds/** - Interactive demo pages:
  - spatial-processing.html
  - map-viz.html
  - satellite-imagery.html
  - pipeline-builder.html

## Deployment

This site is deployed on GitHub Pages at:
```
https://yewtaah.github.io/geospatial-aws-book/
```

Any push to the `main` branch will automatically update the live site.

## Contributing

Found a bug or have a suggestion? Open an issue or submit a pull request.

## Related Resources

- [Code Examples Repository](https://github.com/yewtaah/geospatial-aws-book-code)
- [AWS Geospatial Services](https://aws.amazon.com/geospatial/)
- [Book on Packt](https://www.packtpub.com/)
- [Also available on O'Reilly](https://www.oreilly.com/)
- [Available on Amazon](https://www.amazon.com/)

## License

Content and code examples are provided under the MIT License.

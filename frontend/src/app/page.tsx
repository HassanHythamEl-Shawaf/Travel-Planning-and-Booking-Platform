import Link from "next/link";

const destinations = [
  {
    number: "01",
    title: "Flights",
    description: "Find the right route and compare your options.",
    href: "/flights",
    className: "destination-flight",
  },
  {
    number: "02",
    title: "Stays",
    description: "Discover places to stay for every kind of trip.",
    href: "/hotels",
    className: "destination-stay",
  },
  {
    number: "03",
    title: "Itineraries",
    description: "Explore trip plans and make them your own.",
    href: "/itineraries/public",
    className: "destination-itinerary",
  },
  {
    number: "04",
    title: "Travel stories",
    description: "Read notes, recommendations and stories from travellers.",
    href: "/blog",
    className: "destination-stories",
  },
];

export default function HomePage() {
  return (
    <main>
      <header className="public-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span>wayfarer</span>
        </Link>
        <nav className="public-nav" aria-label="Main navigation">
          <Link href="/flights">Flights</Link>
          <Link href="/hotels">Stays</Link>
          <Link href="/itineraries/public">Itineraries</Link>
          <Link href="/blog">Stories</Link>
        </nav>
        <div className="public-actions">
          <Link className="button button-ghost button-small" href="/login">Log in</Link>
          <Link className="button button-primary button-small" href="/register">Create account</Link>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-line" /> A better way to get away</p>
          <h1>Make room for<br /><em>the journey.</em></h1>
          <p className="hero-description">
            Find your next flight, stay and story. Bring every part of your trip
            together, at your own pace.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/flights">
              Start exploring <span aria-hidden="true">↗</span>
            </Link>
            <Link className="button button-secondary" href="/register">Plan a trip</Link>
          </div>
          <div className="hero-note">
            <span className="note-mark" aria-hidden="true">✳</span>
            <span>Thoughtful travel starts with a little inspiration.</span>
          </div>
        </div>
        <div className="hero-art" role="img" aria-label="Abstract illustration of a coastal destination">
          <div className="sun-disc" />
          <div className="art-label art-label-top">36° 14′ N<br />29° 59′ E</div>
          <div className="art-land art-land-back" />
          <div className="art-land art-land-front" />
          <div className="art-water"><span /><span /><span /></div>
          <div className="art-label art-label-bottom">Somewhere worth going</div>
          <div className="art-stamp">GO<br />SLOW</div>
        </div>
      </section>

      <section className="discovery-section" aria-labelledby="discover-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your next chapter</p>
            <h2 id="discover-heading">Where will you begin?</h2>
          </div>
          <p className="section-aside">
            A great trip is more than a destination.<br />Start with what feels right.
          </p>
        </div>
        <div className="destination-grid">
          {destinations.map((destination) => (
            <Link
              className={`destination-card ${destination.className}`}
              href={destination.href}
              key={destination.title}
            >
              <span className="destination-number">{destination.number}</span>
              <span className="destination-arrow" aria-hidden="true">↗</span>
              <span className="destination-content">
                <strong>{destination.title}</strong>
                <span>{destination.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
      <footer className="public-footer">
        <Link className="brand brand-footer" href="/">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span>wayfarer</span>
        </Link>
        <span>Travel, thoughtfully planned.</span>
        <Link href="/register">Your next trip starts here <span aria-hidden="true">↗</span></Link>
      </footer>
    </main>
  );
}

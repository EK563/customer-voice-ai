export function REVIEW_QUERIES(brand, domain) {
  const b = `"${String(brand || domain).replace(/"/g, '')}"`;

  return [
    `${b} review complaint`,
    `${b} disappointed review`,
    `${b} "would not recommend"`,
    `${b} "poor quality" review`,
    `${b} "not as described" review`,
    `${b} "customer service" complaint`,
    `${b} "never received" order`,
    `${b} "late delivery"`,
    `${b} "wrong size"`,
    `${b} sizing complaint`,
    `${b} shipping complaint`,
    `${b} quality complaint`,
    `${b} refund complaint`,
    `${b} customer complaints`,
    `${b} "not worth"`,
    `${b} "waste of money"`,
    `${b} avoid`,
    `site:trustpilot.com ${b}`,
    `site:reddit.com ${b} review`,
    `site:reddit.com ${b} complaint`,
    `site:bbb.org ${b}`,
    `site:sitejabber.com ${b}`,
    `site:yelp.com ${b}`,
  ];
}

export function HISTORICAL_REVIEW_QUERIES(brand, domain) {
  const b = `"${String(brand || domain).replace(/"/g, '')}"`;

  return [
    `${b} review complaint`,
    `${b} "would not recommend"`,
    `${b} "poor quality" review`,
    `${b} sizing complaint`,
    `${b} shipping complaint`,
    `${b} quality complaint`,
    `${b} "customer service" complaint`,
    `site:trustpilot.com ${b}`,
    `site:reddit.com ${b} complaint`,
    `site:bbb.org ${b}`,
  ];
}

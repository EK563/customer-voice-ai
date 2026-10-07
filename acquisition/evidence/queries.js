export function REVIEW_QUERIES(brand, domain) {
  const b = `"${String(brand || domain).replace(/"/g, '')}"`;
  return [
    `${b} review complaint`, `${b} disappointed review`, `${b} "would not recommend"`,
    `${b} "poor quality" review`, `${b} "not as described" review`, `${b} "customer service" complaint`,
    `${b} "never received" order`, `${b} "late delivery"`, `${b} "wrong size"`,
    `site:trustpilot.com ${b}`, `site:reddit.com ${b} review`, `site:reddit.com ${b} complaint`,
    `site:bbb.org ${b}`, `site:sitejabber.com ${b}`, `site:yelp.com ${b}`,
    `${b} customer reviews negative`, `${b} customer complaints`, `${b} refund complaint`,
    `${b} shipping complaint`, `${b} quality complaint`, `${b} service complaint`, `${b} "not worth"`,
    `${b} "waste of money"`, `${b} avoid`, `${b} issue order`, `site:trustpilot.com ${domain}`,
    `site:reddit.com ${domain} review`, `site:bbb.org ${domain}`,
  ];
}

// Official U.S. state (+ DC, PR) names, USPS codes and FIPS codes — the
// same identifiers as Census national_state2020.txt. Static so state names
// and abbreviations resolve deterministically in the parser without a
// database round trip. Pure.

export interface UsState {
  usps: string;
  fips: string;
  name: string;
}

export const US_STATES: UsState[] = [
  ["AL", "01", "Alabama"], ["AK", "02", "Alaska"], ["AZ", "04", "Arizona"], ["AR", "05", "Arkansas"],
  ["CA", "06", "California"], ["CO", "08", "Colorado"], ["CT", "09", "Connecticut"], ["DE", "10", "Delaware"],
  ["DC", "11", "District of Columbia"], ["FL", "12", "Florida"], ["GA", "13", "Georgia"], ["HI", "15", "Hawaii"],
  ["ID", "16", "Idaho"], ["IL", "17", "Illinois"], ["IN", "18", "Indiana"], ["IA", "19", "Iowa"],
  ["KS", "20", "Kansas"], ["KY", "21", "Kentucky"], ["LA", "22", "Louisiana"], ["ME", "23", "Maine"],
  ["MD", "24", "Maryland"], ["MA", "25", "Massachusetts"], ["MI", "26", "Michigan"], ["MN", "27", "Minnesota"],
  ["MS", "28", "Mississippi"], ["MO", "29", "Missouri"], ["MT", "30", "Montana"], ["NE", "31", "Nebraska"],
  ["NV", "32", "Nevada"], ["NH", "33", "New Hampshire"], ["NJ", "34", "New Jersey"], ["NM", "35", "New Mexico"],
  ["NY", "36", "New York"], ["NC", "37", "North Carolina"], ["ND", "38", "North Dakota"], ["OH", "39", "Ohio"],
  ["OK", "40", "Oklahoma"], ["OR", "41", "Oregon"], ["PA", "42", "Pennsylvania"], ["RI", "44", "Rhode Island"],
  ["SC", "45", "South Carolina"], ["SD", "46", "South Dakota"], ["TN", "47", "Tennessee"], ["TX", "48", "Texas"],
  ["UT", "49", "Utah"], ["VT", "50", "Vermont"], ["VA", "51", "Virginia"], ["WA", "53", "Washington"],
  ["WV", "54", "West Virginia"], ["WI", "55", "Wisconsin"], ["WY", "56", "Wyoming"], ["PR", "72", "Puerto Rico"],
].map(([usps, fips, name]) => ({ usps, fips, name }));

export const STATE_BY_USPS = new Map(US_STATES.map((s) => [s.usps, s]));
export const STATE_BY_NAME = new Map(US_STATES.map((s) => [s.name.toLowerCase(), s]));
export const STATE_BY_FIPS = new Map(US_STATES.map((s) => [s.fips, s]));

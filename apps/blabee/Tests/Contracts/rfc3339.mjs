const RFC3339_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseComponents(value) {
  if (typeof value !== "string") return null;
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) return null;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fractionText,
    offsetSign,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (fractionText !== undefined && fractionText.length > 9) return null;
  if (offsetHourText !== undefined && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return null;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    nanosecond: BigInt((fractionText ?? "").padEnd(9, "0") || "0"),
    offsetSign,
    offsetHour: Number(offsetHourText ?? 0),
    offsetMinute: Number(offsetMinuteText ?? 0),
  };
}

// Howard Hinnant's civil-date algorithm, returning days since 1970-01-01.
// It deliberately avoids Date.UTC's special handling for years 0000-0099.
function daysFromCivil(year, month, day) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

export function isStrictRfc3339DateTime(value) {
  return parseComponents(value) !== null;
}

export function parseStrictRfc3339DateTime(value) {
  const components = parseComponents(value);
  if (!components) return null;
  const offsetDirection = components.offsetSign === "+" ? 1 : components.offsetSign === "-" ? -1 : 0;
  const offsetSeconds = offsetDirection * (components.offsetHour * 60 + components.offsetMinute) * 60;
  const localSeconds = (
    daysFromCivil(components.year, components.month, components.day) * 86_400
    + components.hour * 3_600
    + components.minute * 60
    + components.second
  );
  return BigInt(localSeconds - offsetSeconds) * NANOSECONDS_PER_SECOND + components.nanosecond;
}

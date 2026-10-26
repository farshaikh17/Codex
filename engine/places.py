"""Country and region vocabulary for the geography gate. Public reference data only; no candidate data.

places(text) returns ISO 3166-1 alpha-2 codes, region names and WORLDWIDE found in text. Short uppercase codes
(US, UK, EU, EMEA, ...) match case-sensitively, so ordinary words such as "us" never count. City names are not
recognised: a city-only location yields no place, which leaves the gate unknown rather than guessing.
"""
import re
COUNTRIES={
 'AE':['United Arab Emirates','UAE'],'AR':['Argentina'],'AT':['Austria'],'AU':['Australia'],'BD':['Bangladesh'],'BE':['Belgium'],
 'BG':['Bulgaria'],'BR':['Brazil','Brasil'],'CA':['Canada'],'CH':['Switzerland'],'CL':['Chile'],'CN':['China'],'CO':['Colombia'],
 'CR':['Costa Rica'],'CY':['Cyprus'],'CZ':['Czech Republic','Czechia'],'DE':['Germany','Deutschland'],'DK':['Denmark'],'EE':['Estonia'],
 'EG':['Egypt'],'ES':['Spain'],'FI':['Finland'],'FR':['France'],'GB':['United Kingdom','UK','Great Britain','England','Scotland','Wales','Northern Ireland'],
 'GR':['Greece'],'HK':['Hong Kong'],'HR':['Croatia'],'HU':['Hungary'],'ID':['Indonesia'],'IE':['Ireland'],'IL':['Israel'],'IN':['India'],
 'IT':['Italy'],'JP':['Japan'],'KE':['Kenya'],'KR':['South Korea','Korea'],'LK':['Sri Lanka'],'LT':['Lithuania'],'LU':['Luxembourg'],
 'LV':['Latvia'],'MA':['Morocco'],'MT':['Malta'],'MX':['Mexico'],'MY':['Malaysia'],'NG':['Nigeria'],'NL':['Netherlands','The Netherlands','Holland'],
 'NO':['Norway'],'NZ':['New Zealand'],'PE':['Peru'],'PH':['Philippines'],'PK':['Pakistan'],'PL':['Poland'],'PT':['Portugal'],'RO':['Romania'],
 'RS':['Serbia'],'SA':['Saudi Arabia'],'SE':['Sweden'],'SG':['Singapore'],'SI':['Slovenia'],'SK':['Slovakia'],'TH':['Thailand'],'TR':['Turkey','Türkiye'],
 'TW':['Taiwan'],'UA':['Ukraine'],'US':['United States','United States of America','USA','US','U.S.','U.S.A.'],'UY':['Uruguay'],'VN':['Vietnam','Viet Nam'],
 'ZA':['South Africa'],
}
EU={'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'}
EUROPE=EU|{'GB','CH','NO','RS','UA','TR'}
MIDDLE_EAST={'AE','SA','IL','EG','TR'}
AFRICA={'EG','KE','MA','NG','ZA'}
APAC={'AU','BD','CN','HK','ID','IN','JP','KR','LK','MY','NZ','PH','PK','SG','TH','TW','VN'}
LATAM={'AR','BR','CL','CO','CR','MX','PE','UY'}
REGIONS={'EU':EU,'EUROPE':EUROPE,'EMEA':EUROPE|MIDDLE_EAST|AFRICA,'MIDDLE_EAST':MIDDLE_EAST,'AFRICA':AFRICA,'APAC':APAC,'ASIA':APAC-{'AU','NZ'},
         'LATAM':LATAM,'SOUTH_AMERICA':{'AR','BR','CL','CO','PE','UY'},'CENTRAL_AMERICA':{'CR','MX'},'CARIBBEAN':set(),
         'NORTH_AMERICA':{'US','CA','MX'},'AMERICAS':{'US','CA'}|LATAM}
REGION_NAMES={'EU':['EU','European Union'],'EUROPE':['Europe','European'],'EMEA':['EMEA'],'MIDDLE_EAST':['Middle East'],'AFRICA':['Africa'],
              'APAC':['APAC','APJ','Asia Pacific','Asia-Pacific'],'ASIA':['Asia'],'LATAM':['LATAM','LatAm','Latin America'],
              'SOUTH_AMERICA':['South America'],'CENTRAL_AMERICA':['Central America'],'CARIBBEAN':['Caribbean'],
              'NORTH_AMERICA':['North America'],'AMERICAS':['Americas','AMER']}
WORLDWIDE='WORLDWIDE'
# 'global' alone counts only as a bare location label ("Global", "Remote - Global"), never inside prose such as "a global company".
# 'anywhere' counts only when not narrowed: "work from anywhere in the US" is the US, not worldwide.
_WORLDWIDE=re.compile(r"(?i)\bworld-?wide\b|\banywhere in the world\b|\b(?:work|live) from anywhere\b(?! in\b)|"
                      r"^\W*(?:remote\W+)?global(?:ly)?(?:\W+remote)?\W*$")
def _pattern(names):
    """Uppercase-only aliases of up to four letters (plus dotted forms) match case-sensitively; other names ignore case."""
    exact=[n for n in names if re.fullmatch(r'[A-Z.]{2,6}',n) or n in ('LatAm',)]
    loose=[n for n in names if n not in exact]
    parts=[]
    if exact: parts.append(r'(?<![A-Za-z])(?:%s)(?![A-Za-z])'%'|'.join(re.escape(n) for n in sorted(exact,key=len,reverse=True)))
    if loose: parts.append(r'(?i:\b(?:%s)\b)'%'|'.join(re.escape(n) for n in sorted(loose,key=len,reverse=True)))
    return re.compile('|'.join(parts))
_MATCHERS=[(code,_pattern(names)) for code,names in COUNTRIES.items()]+[(r,_pattern(n)) for r,n in REGION_NAMES.items()]+[(WORLDWIDE,_WORLDWIDE)]
def places(text):
    text=text or ''
    found={code for code,pattern in _MATCHERS if pattern.search(text)}
    if 'IN' in found and not re.search(r'(?i)\bindia\b',text): found.discard('IN')  # defensive: 'IN' is never an alias
    return found
def covers(found,countries):
    """True when a place set includes one of the countries, a region containing one, or WORLDWIDE."""
    countries=set(countries)
    return bool(found&countries) or WORLDWIDE in found or any(countries&REGIONS.get(p,set()) for p in found)

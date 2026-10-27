import json,unittest
from pathlib import Path
from engine.extract import extract,parse_pay,sections
ROOT=Path(__file__).resolve().parents[2]
REQS='\n'.join('Requirement line %d with enough words to be realistic.'%n for n in range(60))
def version(description='',**extra):
    return {'title':'Implementation Manager','locations':[{'text':'India','source':'location'}],'workplace_type':None,
            'description':description,'compensation_raw':None,'content_hash':'h','first_seen_at':'2026-10-26T00:00:00+00:00'}|extra
def quotes(record,field):
    return [i['quote'] for i in record['fields'][field]['items']]
def interps(record,field):
    return [i['interpretation'] for i in record['fields'][field]['items']]
FILLER=' '.join(['Context sentence about the team and the work.']*20)
class RequirementTests(unittest.TestCase):
    def test_mandatory_and_preferred_are_kept_apart_with_complete_text(self):
        r=extract(version(FILLER+"\nWhat you'll bring\n"+REQS+"\nFluent French (required).\nSQL experience is helpful, but not required.\n"
                          "Nice to have\nExperience with Workday.\nBenefits\nHealth cover."))
        mandatory=quotes(r,'requirements_mandatory')
        self.assertEqual(mandatory,[REQS+'\nFluent French (required).'])
        self.assertEqual(quotes(r,'requirements_preferred'),['SQL experience is helpful, but not required.','Experience with Workday.'])
        self.assertNotIn('Health cover',''.join(mandatory))
        self.assertEqual(r['state'],'ok')
    def test_required_and_desired_subheadings(self):
        r=extract(version(FILLER+'\nQualifications\n*Required:\n5 years in implementation.\nDesired:\nTelecom domain knowledge.\nLocation\nThis role is remote in India.'))
        self.assertEqual(quotes(r,'requirements_mandatory'),['5 years in implementation.'])
        self.assertEqual(quotes(r,'requirements_preferred'),['Telecom domain knowledge.'])
        self.assertIn('This role is remote in India.',quotes(r,'location'))
    def test_unsectioned_requirements_are_flagged_not_guessed(self):
        r=extract(version(FILLER+' You will need SQL.'))
        self.assertEqual(r['fields']['requirements_mandatory'],{'state':'not_stated','items':[]})
        self.assertEqual((r['state'],r['warnings']),('uncertain',['requirements_not_sectioned']))
    def test_unknown_short_lines_stay_content(self):
        kinds=[k for k,_,_ in sections('Requirements\nAbility to use GitLab\nExperience selling software\nResponsibilities\nShip things')]
        self.assertEqual(kinds,['requirements_mandatory','other'])
class CompensationTests(unittest.TestCase):
    def ranges(self,text):
        r=parse_pay(text)
        return r and [(x['min'],x['max'],x['currency'],x['currency_symbol']) for x in r['ranges']]
    def test_explicit_amounts_keep_original_units(self):
        self.assertEqual(self.ranges('$139,200—$235,200 USD'),[(139200,235200,'USD','$')])
        self.assertEqual(self.ranges('Poland base salary range: 248,000zł - 372,000zł'),[(248000,372000,None,'zł')])
        self.assertEqual(self.ranges('€60.000 - €75.000 per year'),[(60000,75000,None,'€')])
        self.assertEqual(self.ranges('INR 12,00,000 - 18,00,000 per annum'),[(1200000,1800000,'INR',None)])
        self.assertEqual(self.ranges('$11.4K – $20.4K'),[(11400,20400,None,'$')])
        lakh=parse_pay('₹10-12 LPA')
        self.assertEqual((lakh['ranges'][0]['min'],lakh['amount_unit'],lakh['period']),(10,'lakh','year'))
        self.assertIsNone(parse_pay('$90K')['ranges'][0]['currency'],'a bare $ is not assumed to be USD')
    def test_no_amount_without_currency_or_k(self):
        for text in ('2018-2020','401(k) plan','40 days off per year','Fortune 100 companies','5-7 years of experience'):
            self.assertIsNone(parse_pay(text),text)
    def test_basis_variable_and_estimate_are_separate(self):
        ote=parse_pay('Estimated OTE: 65K-80K USD')
        self.assertEqual((ote['basis'],ote['estimated'],ote['ranges'][0]['min']),('ote',True,65000))
        base=parse_pay('170-190K base + commission')
        self.assertEqual((base['basis'],base['variable_mentioned'],base['ranges'][0]['max']),('base',True,190000))
    def test_ashby_summary_segments(self):
        r=extract(version(FILLER,compensation_raw='$45K – $55K • Offers Commission • Estimated OTE:  65K-80K USD • Multiple Ranges'))
        self.assertEqual(quotes(r,'compensation'),['$45K – $55K','Offers Commission','Estimated OTE:  65K-80K USD','Multiple Ranges'])
        parsed=[i for i in interps(r,'compensation') if i]
        self.assertEqual([p['basis'] for p in parsed],['unspecified','ote'])
        self.assertTrue(all(p['multiple_ranges'] for p in parsed))
    def test_structured_feed_fields(self):
        lever=extract(version(FILLER,compensation_raw='{"min": 170000, "max": 185000, "currency": "USD", "interval": "per-year-salary"}'))
        self.assertEqual(interps(lever,'compensation')[0]['ranges'][0]|{},{'min':170000,'max':185000,'currency':'USD','currency_symbol':None,'text':None})
        self.assertEqual(interps(lever,'compensation')[0]['period'],'year')
        gh=json.dumps([{'min_cents':9000000,'max_cents':11000000,'currency_type':'USD','title':'US base salary','blurb':'Annual'},
                       {'min_cents':7000000,'max_cents':8000000,'currency_type':'CAD','title':'Canada base salary','blurb':None}])
        got=interps(extract(version(FILLER,compensation_raw=gh)),'compensation')
        self.assertEqual([(g['ranges'][0]['min'],g['ranges'][0]['currency'],g['basis'],g['multiple_ranges']) for g in got],
                         [(90000,'USD','base',True),(70000,'CAD','base',True)])
        self.assertEqual(got[0]['period'],'year')
    def test_ashby_tiers_keep_currency_period_and_basis_per_component(self):
        tiers={'source':'ashby.compensationTiers','summary':'$54.6K – $61.2K • Offers Equity • Multiple Ranges','tiers':[
            {'title':'United States','summary':'$54.6K – $61.2K • Offers Equity','additional_information':None,'components':[
                {'compensationType':'Salary','currencyCode':'USD','interval':'1 YEAR','minValue':54600,'maxValue':61200,'summary':'$54.6K – $61.2K'},
                {'compensationType':'EquityCashValue','currencyCode':'USD','interval':'1 YEAR','minValue':None,'maxValue':None,'summary':'Offers Equity'}]},
            {'title':'Canada','summary':'CA$50K – CA$58K','additional_information':'Estimated OTE:  65K-80K USD','components':[
                {'compensationType':'Salary','currencyCode':'CAD','interval':'1 YEAR','minValue':50000,'maxValue':58000,'summary':'CA$50K – CA$58K'},
                {'compensationType':'Commission','currencyCode':None,'interval':'NONE','minValue':5000,'maxValue':5000,'summary':'5K'},
                {'compensationType':'EquityPercentage','currencyCode':None,'interval':'2 YEAR','minValue':0.05,'maxValue':0.1,'summary':'0.05% – 0.1%'}]}]}
        raw=json.dumps(tiers,ensure_ascii=False,separators=(',',':'))
        r=extract(version(FILLER,compensation_raw=raw))
        items=r['fields']['compensation']['items']
        self.assertEqual(r['fields']['compensation']['state'],'stated')
        note=[i for i in items if i['method']=='ats_field:compensationTiers.additional_information']
        self.assertEqual([(i['quote'],i['interpretation']) for i in note],[('Estimated OTE:  65K-80K USD',None)])  # quoted, never parsed
        items=[i for i in items if i['method']=='ats_field:compensationTiers']
        got=[(i['interpretation']['label'],i['interpretation']['component_type'],i['interpretation']['basis'],i['interpretation']['period'],
              [(x['min'],x['max'],x['currency']) for x in i['interpretation']['ranges']]) for i in items]
        self.assertEqual(got,[('United States','Salary','base','year',[(54600,61200,'USD')]),
                              ('United States','EquityCashValue','equity','year',[]),
                              ('Canada','Salary','base','year',[(50000,58000,'CAD')]),
                              ('Canada','Commission','variable',None,[(5000,5000,None)]),
                              ('Canada','EquityPercentage','equity',None,[(0.05,0.1,None)])])
        commission=items[3]['interpretation']
        self.assertEqual((commission['interval_raw'],commission['ranges'][0]['currency'],commission['ranges'][0]['currency_symbol']),('NONE',None,None))  # no period and no currency are inferred
        self.assertEqual((items[4]['interpretation']['interval_raw'],items[4]['interpretation']['amount_unit']),('2 YEAR','percent'))
        self.assertTrue(all(i['interpretation']['multiple_ranges'] for i in items))
        for i in items: self.assertIn(i['quote'],raw)  # each quote is the component exactly as published
    def test_greenhouse_label_is_text_not_html(self):
        gh=json.dumps([{'min_cents':13920000,'max_cents':23520000,'currency_type':'USD','title':'United States Salary Range',
                        'blurb':'<p><em>The base salary range is for residents of the&nbsp;United States only.</em></p>'}])
        g=interps(extract(version(FILLER,compensation_raw=gh)),'compensation')[0]
        self.assertEqual(g['label'],'United States Salary Range The base salary range is for residents of the United States only.')
        self.assertNotIn('<',g['label'])
        self.assertEqual((g['basis'],g['period'],g['ranges'][0]['currency']),('base',None,'USD'))  # no pay period is published, none inferred
    def test_description_pay_section_and_signal_without_amount(self):
        r=extract(version(FILLER+'\nUnited States Salary Range\n$139,200—$235,200 USD\nBenefits\nHealth.'))
        self.assertEqual(r['fields']['compensation']['state'],'stated')
        self.assertEqual(interps(r,'compensation')[0]['ranges'][0]['max'],235200)
        signalled=extract(version(FILLER+'\nRequirements\nSQL.\nThis role comprises a base salary component, plus a bonus.'))
        self.assertEqual(signalled['fields']['compensation'],{'state':'not_stated','items':[]})
        self.assertIn('compensation_signalled_not_found',signalled['warnings'])
        quiet=extract(version(FILLER+'\nRequirements\nSQL.\nEnjoy 40 days off per year.'))
        self.assertNotIn('compensation_signalled_not_found',quiet['warnings'])
class PayBoundTests(unittest.TestCase):
    """A published bound is kept as published; a missing one stays None and is never copied from the other bound."""
    def ashby(self,low,high):
        tiers={'source':'ashby.compensationTiers','summary':None,'tiers':[{'title':'United States','summary':None,'additional_information':None,
               'components':[{'compensationType':'Salary','currencyCode':'USD','interval':'1 YEAR','minValue':low,'maxValue':high,'summary':None}]}]}
        return interps(extract(version(FILLER,compensation_raw=json.dumps(tiers))),'compensation')[0]['ranges']
    def test_ashby_minimum_only_stays_open_ended(self):
        self.assertEqual([(r['min'],r['max']) for r in self.ashby(90000,None)],[(90000,None)])
    def test_ashby_maximum_only_stays_open_ended(self):
        self.assertEqual([(r['min'],r['max']) for r in self.ashby(None,110000)],[(None,110000)])
    def test_ashby_both_bounds_missing_gives_no_range(self):
        self.assertEqual(self.ashby(None,None),[])
    def test_ashby_both_bounds_kept_as_published(self):
        self.assertEqual([(r['min'],r['max']) for r in self.ashby(90000,110000)],[(90000,110000)])
    def test_ashby_published_exact_figure_stays_exact(self):
        self.assertEqual([(r['min'],r['max']) for r in self.ashby(100000,100000)],[(100000,100000)])
    def test_greenhouse_one_sided_ranges(self):
        for given,want in (({'min_cents':9000000},(90000,None)),({'max_cents':11000000},(None,110000))):
            raw=json.dumps([given|{'currency_type':'USD','title':'Salary'}])
            r=interps(extract(version(FILLER,compensation_raw=raw)),'compensation')[0]['ranges']
            self.assertEqual([(x['min'],x['max']) for x in r],[want])
        empty=extract(version(FILLER,compensation_raw=json.dumps([{'currency_type':'USD','title':'Salary'}])))
        self.assertNotIn('ats_field:pay_input_ranges',[i['method'] for i in empty['fields']['compensation']['items']])
    def test_lever_one_sided_and_empty_ranges(self):
        raw=json.dumps({'min':90000,'max':None,'currency':'USD','interval':'per-year-salary'})
        r=interps(extract(version(FILLER,compensation_raw=raw)),'compensation')[0]['ranges']
        self.assertEqual([(x['min'],x['max']) for x in r],[(90000,None)])
        none=extract(version(FILLER,compensation_raw=json.dumps({'min':None,'max':None,'currency':'USD','interval':'per-year-salary'})))
        self.assertTrue(all(not (i['interpretation'] or {}).get('ranges') for i in none['fields']['compensation']['items']))
class CompanyFigureAndCodedDollarTests(unittest.TestCase):
    """Company revenue or funding is never pay; genuine pay is kept even when written in millions; coded dollars name a currency."""
    def ranges(self,text):
        return [(r['min'],r['max'],r['currency'],r['currency_symbol']) for r in (parse_pay(text) or {}).get('ranges',[])]
    def test_company_revenue_and_funding_are_not_pay(self):
        for text in ('Twilio generates nearly $1B annually in revenue.','We raised $50M in Series B funding from leading investors.',
                     'Our customers processed $2.5 billion in payments last year.','The company is valued at $3B.'):
            self.assertEqual(self.ranges(text),[],text)
        r=extract(version(FILLER+'\nRequirements\nSQL.\nTwilio generates nearly $1B annually in revenue.'))
        self.assertEqual(r['fields']['compensation']['state'],'not_stated')  # previously 'stated' with a $1 range
    def test_real_pay_in_millions_is_kept(self):
        self.assertEqual(self.ranges('Base salary JPY 6M - 8M per year'),[(6_000_000,8_000_000,'JPY',None)])
        self.assertEqual(self.ranges('INR 3M - 4M per annum base'),[(3_000_000,4_000_000,'INR',None)])
        self.assertEqual(self.ranges('Salary: $1.2M - $1.5M per year'),[(1_200_000,1_500_000,None,'$')])
    def test_revenue_beside_salary_keeps_only_the_salary(self):
        self.assertEqual(self.ranges('Our customers process $2B in payments. The base salary is $140,000 - $160,000 USD per year.'),
                         [(140000,160000,'USD','$')])
    def test_coded_dollars_name_their_currency(self):
        self.assertEqual(self.ranges('US$130,000 - US$150,000 per year base salary'),[(130000,150000,'USD','US$')])  # one range, not two
        self.assertEqual(self.ranges('CA$130,000 - CA$150,000 per year base salary'),[(130000,150000,'CAD','CA$')])
        self.assertEqual(self.ranges('A$120,000 - A$140,000 per year'),[(120000,140000,'AUD','A$')])
    def test_unit_between_amounts_keeps_one_range(self):
        r=parse_pay('Based in Colorado, Hawaii, Minnesota or Vermont : $30.09/hr - $37.61/hr.')  # real Twilio wording
        self.assertEqual([(x['min'],x['max']) for x in r['ranges']],[(30.09,37.61)])
        self.assertEqual(r['period'],'hour')
    def test_bare_dollar_stays_currency_unknown(self):
        self.assertEqual(self.ranges('$130,000 - $150,000 per year base salary'),[(130000,150000,None,'$')])
class WorkplaceAndTypeTests(unittest.TestCase):
    def test_explicit_disagreement_is_conflicting(self):
        r=extract(version(FILLER,locations=[{'text':'Remote (US)','source':'location'}],workplace_type='OnSite'))
        self.assertEqual((r['fields']['workplace']['state'],sorted(interps(r,'workplace'))),('conflicting',['onsite','remote']))
        agree=extract(version(FILLER+'\nThis position is fully remote.',locations=[{'text':'Remote, France','source':'location'}],workplace_type='Remote'))
        self.assertEqual(agree['fields']['workplace']['state'],'stated')
        hybrid_cloud=extract(version(FILLER+' We build hybrid cloud tooling.'))
        self.assertEqual(hybrid_cloud['fields']['workplace']['state'],'not_stated')
    def test_employment_type_needs_role_wording(self):
        r=extract(version(FILLER+'\nHow GitLab Supports Full-Time Employees\nBenefits.',title='Talent Sourcer, Contractor'))
        self.assertEqual((r['fields']['employment_type']['state'],interps(r,'employment_type')),('stated',['contract']))
        both=extract(version(FILLER+'\nDrivetrain is looking for a full-time designer.',title='Visual Designer (Contractor)'))
        self.assertEqual(both['fields']['employment_type']['state'],'conflicting')
    def test_location_restrictions_are_quoted_not_interpreted(self):
        r=extract(version(FILLER+'\nCandidates must be located in the EU and have the right to work there.\nWe sell to an executive sponsor.'))
        restriction=[i for i in r['fields']['location']['items'] if i['method']=='description_text']
        self.assertEqual([i['quote'] for i in restriction],['Candidates must be located in the EU and have the right to work there.'])
        self.assertIsNone(restriction[0]['interpretation'])
class QualityTests(unittest.TestCase):
    def test_empty_description_is_not_retrieved_everywhere(self):
        r=extract(version('',locations=[]))
        self.assertEqual(r['state'],'failed')
        self.assertEqual({f['state'] for f in r['fields'].values()},{'not_retrieved'})
    def test_thin_navigation_truncated_and_list_warnings(self):
        self.assertIn('thin_description',extract(version('Loading jobs. Enable JavaScript.'))['warnings'])
        nav='\n'.join(['Home','Jobs','About','Teams','Apply','Blog','Press','Contact','Legal'])
        self.assertEqual(extract(version(nav))['state'],'thin')
        self.assertIn('navigation_only',extract(version(nav))['warnings'])
        self.assertIn('possibly_truncated',extract(version(FILLER+' Read more'))['warnings'])
        listing='\n'.join('Role %d - Remote\nApply now'%n for n in range(4))
        self.assertIn('list_captured_as_description',extract(version(FILLER+'\n'+listing))['warnings'])
    def test_items_carry_provenance_and_no_confidence_scores(self):
        r=extract(version(FILLER+'\nRequirements\nSQL.',workplace_type='Remote'),'https://jobs.example/1')
        for field in r['fields'].values():
            for i in field['items']:
                self.assertEqual(set(i),{'field','source_url','retrieved_at','quote','interpretation','method','schema_version'})
                self.assertEqual((i['source_url'],i['retrieved_at'],i['schema_version']),('https://jobs.example/1','2026-10-26T00:00:00+00:00','evidence-1'))
        self.assertNotIn('confidence',json.dumps(r))
class CommittedSnapshotTests(unittest.TestCase):
    def test_every_quote_is_verbatim_source_text(self):
        """No invented facts: every quote must appear in the posting's own fields. Runs over every committed posting."""
        jobs=[j for f in sorted((ROOT/'public'/'boards').glob('*.json')) for j in json.loads(f.read_text())['jobs']]
        self.assertGreater(len(jobs),100)
        for job in jobs:
            r=extract(job,job['url'])
            source='\n'.join([job['title'] or '',job['description'] or '',job['compensation_raw'] or '',job['workplace_type'] or '']+
                             [l['text'] for l in job['locations']])
            source_ws=' '.join(source.split())
            for field in r['fields'].values():
                for i in field['items']:
                    if i['method']=='ats_field:pay_input_ranges': continue  # quote is one element of the JSON array
                    self.assertIn(' '.join(i['quote'].split()),source_ws,(job['key'],i['method']))
if __name__=='__main__':unittest.main()
